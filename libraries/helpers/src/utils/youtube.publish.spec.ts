import {
  youtubeAuthError,
  youtubeHandledErrorMessage,
  youtubeUploadedVideoId,
} from './youtube.publish';

describe('youtube publish helpers', () => {
  it('maps Google 401 payloads to a refresh-token', () => {
    expect(
      youtubeAuthError(JSON.stringify({ status: 401, statusText: 'Unauthorized' }))
    ).toEqual({
      type: 'refresh-token',
      value: 'Token expired or invalid, please reconnect your YouTube account.',
    });
  });

  it('maps invalid grant payloads to a re-authentication message', () => {
    expect(youtubeAuthError('error_description=invalid_grant')).toEqual({
      type: 'refresh-token',
      value: 'Please re-authenticate your YouTube account',
    });
    expect(youtubeAuthError('UNAUTHENTICATED')).toEqual({
      type: 'refresh-token',
      value: 'Please re-authenticate your YouTube account',
    });
  });

  it('only accepts an upload result with a video id', () => {
    expect(youtubeUploadedVideoId({ data: { id: 'lv_iaBoDmYw' } })).toBe(
      'lv_iaBoDmYw'
    );
    expect(youtubeUploadedVideoId({ err: true, data: { id: 'live' } })).toBe(
      undefined
    );
    expect(youtubeUploadedVideoId({ data: {} })).toBe(undefined);
    expect(youtubeUploadedVideoId(undefined)).toBe(undefined);
  });

  it('uses the handled error message or fallback', () => {
    expect(youtubeHandledErrorMessage({ err: true, value: 'Quota' }, 'Fallback')).toBe(
      'Quota'
    );
    expect(youtubeHandledErrorMessage({ err: true }, 'Fallback')).toBe('Fallback');
  });
});
