import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { timer } from '@gitroom/helpers/utils/timer';

@Injectable()
export class RefreshIntegrationService {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService
  ) {}
  async refresh(integration: Integration): Promise<false | AuthTokenDetails> {
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const refresh = await this.refreshProcess(integration, socialProvider);

    if (!refresh) {
      return false as const;
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      !!socialProvider.oneTimeToken,
      integration.organizationId,
      integration.name,
      integration.picture!,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      refresh.accessToken,
      refresh.refreshToken,
      refresh.expiresIn
    );

    return refresh;
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider
  ): Promise<AuthTokenDetails | false> {
    const refresh: false | AuthTokenDetails = await socialProvider
      .refreshToken(integration.refreshToken)
      .catch((err) => false);

    if (!refresh) {
      // Two flows can refresh the same channel at once (two posts, a post and
      // analytics). A provider that replaces the refresh token on every refresh
      // rejects the second one while the first is still storing its tokens:
      // wait for them and reuse them instead of flagging the channel.
      for (let attempt = 0; attempt < 3; attempt++) {
        const stored = await this._integrationService.getIntegrationById(
          integration.organizationId,
          integration.id
        );
        if (
          !stored ||
          stored.refreshNeeded ||
          stored.inBetweenSteps ||
          stored.deletedAt
        ) {
          break;
        }
        if (
          stored.internalId === integration.internalId &&
          stored.providerIdentifier === integration.providerIdentifier &&
          stored.refreshToken &&
          stored.refreshToken !== integration.refreshToken &&
          stored.token !== integration.token &&
          stored.tokenExpiration &&
          stored.tokenExpiration.getTime() > Date.now()
        ) {
          return {
            id: stored.internalId,
            name: stored.name,
            username: stored.profile || '',
            picture: stored.picture || '',
            accessToken: stored.token,
            refreshToken: stored.refreshToken,
            expiresIn: Math.floor(
              (stored.tokenExpiration.getTime() - Date.now()) / 1000
            ),
          };
        }
        if (attempt < 2) {
          await timer(1000 * (attempt + 1));
        }
      }

      await this._integrationService.refreshNeeded(
        integration.organizationId,
        integration.id
      );

      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration
      );

      await this._integrationService.disconnectChannel(integration.organizationId, integration);

      return false;
    }

    if (!socialProvider.reConnect) {
      return refresh;
    }

    const reConnect = await socialProvider.reConnect(
      integration.rootInternalId,
      integration.internalId,
      refresh.accessToken
    );

    return {
      ...refresh,
      ...reConnect,
    };
  }
}
