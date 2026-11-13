'use client';

import React, {
  ChangeEvent,
  ClipboardEvent,
  FC,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@gitroom/react/form/button';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Media } from '@prisma/client';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import EventEmitter from 'events';
import clsx from 'clsx';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';
import dynamic from 'next/dynamic';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { AiImage } from '@gitroom/frontend/components/launches/ai.image';
import { DropFiles } from '@gitroom/frontend/components/layout/drop.files';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ThirdPartyMedia } from '@gitroom/frontend/components/third-parties/third-party.media';
import { ReactSortable } from 'react-sortablejs';
import { MediaComponentInner } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { AiVideo } from '@gitroom/frontend/components/launches/ai.video';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Dashboard } from '@uppy/react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  DeleteCircleIcon,
  CloseCircleIcon,
  DragHandleIcon,
  MediaSettingsIcon,
  InsertMediaIcon,
  DesignMediaIcon,
  VerticalDividerIcon,
  NoMediaIcon,
} from '@gitroom/frontend/components/ui/icons';
const Polonto = dynamic(
  () => import('@gitroom/frontend/components/launches/polonto')
);
const showModalEmitter = new EventEmitter();
export const Pagination: FC<{
  current: number;
  totalPages: number;
  setPage: (num: number) => void;
}> = (props) => {
  const t = useT();

  const { current, totalPages, setPage } = props;
  const totalPagesList = useMemo(() => {
    return Array.from(
      {
        length: totalPages,
      },
      (_, i) => i
    );
  }, [totalPages]);
  return (
    <ul className="flex flex-row items-center gap-1 justify-center mt-[15px]">
      <li className={clsx(current === 0 && 'opacity-20 pointer-events-none')}>
        <div
          className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2 gap-1 ps-2.5 text-gray-400 hover:text-white border-[#1F1F1F] hover:bg-forth"
          aria-label="Go to previous page"
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeftIcon className="lucide lucide-chevron-left h-4 w-4" />
          <span>{t('previous', 'Previous')}</span>
        </div>
      </li>
      {totalPagesList.map((page) => (
        <li key={page} className="">
          <div
            aria-current="page"
            onClick={() => setPage(page)}
            className={clsx(
              'cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:bg-forth h-10 w-10 hover:text-white border-newBorder',
              current === page
                ? 'bg-forth !text-white'
                : 'text-textColor hover:text-white'
            )}
          >
            {page + 1}
          </div>
        </li>
      ))}
      <li
        className={clsx(
          current + 1 === totalPages && 'opacity-20 pointer-events-none'
        )}
      >
        <a
          className="text-textColor hover:text-white group cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2 gap-1 pe-2.5 text-gray-400 border-[#1F1F1F] hover:bg-forth"
          aria-label="Go to next page"
          onClick={() => setPage(current + 1)}
        >
          <span>{t('next', 'Next')}</span>
          <ChevronRightIcon className="lucide lucide-chevron-right h-4 w-4" />
        </a>
      </li>
    </ul>
  );
};
export const ShowMediaBoxModal: FC = () => {
  const [showModal, setShowModal] = useState(false);
  const [callBack, setCallBack] =
    useState<(params: { id: string; path: string }[]) => void | undefined>();
  const closeModal = useCallback(() => {
    setShowModal(false);
    setCallBack(undefined);
  }, []);
  useEffect(() => {
    showModalEmitter.on('show-modal', (cCallback) => {
      setShowModal(true);
      setCallBack(() => cCallback);
    });
    return () => {
      showModalEmitter.removeAllListeners('show-modal');
    };
  }, []);
  if (!showModal) return null;
  return (
    <div className="text-textColor">
      <MediaBox setMedia={callBack!} closeModal={closeModal} />
    </div>
  );
};
export const showMediaBox = (
  callback: (params: { id: string; path: string }) => void
) => {
  showModalEmitter.emit('show-modal', callback);
};
const CHUNK_SIZE = 1024 * 1024;
export const MediaBox: FC<{
  setMedia: (params: { id: string; path: string }[]) => void;
  standalone?: boolean;
  type?: 'image' | 'video';
  closeModal: () => void;
}> = ({ type, standalone, setMedia }) => {
  const [page, setPage] = useState(0);
  const fetch = useFetch();
  const modals = useModals();
  const loadMedia = useCallback(async () => {
    return (await fetch(`/media?page=${page + 1}`)).json();
  }, [page]);
  const { data, mutate, isLoading } = useSWR(`get-media-${page}`, loadMedia);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<
    'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'
  >('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const t = useT();
  const uploaderRef = useRef<any>(null);
  const mediaDirectory = useMediaDirectory();

  const uppy = useUppyUploader({
    allowedFileTypes:
      type == 'image'
        ? 'image/*'
        : type == 'video'
        ? 'video/mp4'
        : 'image/*,video/mp4',
    onUploadSuccess: async (arr) => {
      uppy.clear();
      await mutate();
      if (standalone) {
        return;
      }
      setSelected((prevSelected) => {
        return [...prevSelected, ...arr];
      });
    },
  });

  const addRemoveSelected = useCallback(
    (media: any) => () => {
      if (standalone) {
        return;
      }
      const exists = selected.find((p: any) => p.id === media.id);
      if (exists) {
        setSelected(selected.filter((f: any) => f.id !== media.id));
        return;
      }
      setSelected([...selected, media]);
    },
    [selected]
  );

  const addMedia = useCallback(async () => {
    if (standalone) {
      return;
    }
    // @ts-ignore
    setMedia(selected);
    modals.closeCurrent();
  }, [selected]);

  const addToUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files).slice(0, 10);
    for (const file of files) {
      uppy.addFile(file);
    }
  }, []);

  const dragAndDrop = useCallback(
    async (event: ClipboardEvent<HTMLDivElement> | File[]) => {
      // @ts-ignore
      const clipboardItems = event.map((p) => ({
        kind: 'file',
        getAsFile: () => p,
      }));
      if (!clipboardItems) {
        return;
      }

      const files = [];
      // @ts-ignore
      for (const item of clipboardItems) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      for (const file of files.slice(0, 10)) {
        uppy.addFile(file);
      }
    },
    []
  );

  const deleteImage = useCallback(
    (media: Media) => async (e: any) => {
      e.stopPropagation();
      if (
        !(await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete_the_image',
            'Are you sure you want to delete the image?'
          )
        ))
      ) {
        return;
      }
      await fetch(`/media/${media.id}`, {
        method: 'DELETE',
      });
      mutate();
    },
    [mutate]
  );

  const deleteSelected = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'are_you_sure_you_want_to_delete_selected_media',
          'Are you sure you want to delete the selected media?'
        )
      ))
    ) {
      return;
    }
    for (const media of selected as any[]) {
      await fetch(`/media/${media.id}`, {
        method: 'DELETE',
      });
    }
    setSelected([]);
    mutate();
  }, [selected, mutate]);

  // Search and sort run on the page already loaded (the list endpoint has no
  // server-side search or sort), so they only reorder/filter the current page.
  const visibleMedia = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.results || [])
      .filter((f: any) => {
        if (type === 'video') {
          return f.path.indexOf('mp4') > -1;
        } else if (type === 'image') {
          return f.path.indexOf('mp4') === -1;
        }
        return true;
      })
      .filter((f: any) => !q || (f.name || '').toLowerCase().includes(q));
    const time = (m: any) => new Date(m.createdAt || 0).getTime();
    list.sort((a: any, b: any) => {
      switch (sortBy) {
        case 'oldest':
          return time(a) - time(b);
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'size-desc':
          return (b.fileSize || 0) - (a.fileSize || 0);
        case 'size-asc':
          return (a.fileSize || 0) - (b.fileSize || 0);
        default:
          return time(b) - time(a);
      }
    });
    return list;
  }, [data?.results, type, search, sortBy]);

  const btn = useMemo(() => {
    return (
      <button
        onClick={() => uploaderRef?.current?.click()}
        className="cursor-pointer bg-btnSimple changeColor flex gap-[8px] h-[44px] px-[18px] justify-center items-center rounded-[8px]"
      >
        <PlusIcon size={14} />
        <div>Upload</div>
      </button>
    );
  }, []);

  return (
    <DropFiles className="flex flex-col flex-1" onDrop={dragAndDrop}>
      <div className="flex flex-col flex-1">
        <div
          className={clsx(
            'flex',
            !isLoading && !data?.results?.length && 'hidden'
          )}
        >
          {!isLoading && !!data?.results?.length && (
            <div className="flex-1 text-[14px] font-[600] whitespace-pre-line">
              Select or upload pictures (maximum 10 at a time).{'\n'}
              You can also drag & drop pictures.
            </div>
          )}
          <input
            type="file"
            ref={uploaderRef}
            onChange={addToUpload}
            className="hidden"
            multiple={true}
          />
          {!isLoading && !!data?.results?.length && btn}
        </div>
        {!isLoading && !!data?.results?.length && (
          <div className="flex flex-wrap items-center gap-[8px] mt-[5px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search_media_by_name', 'Search by file name')}
              className="h-[40px] flex-1 min-w-[160px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newTextColor/10 outline-none"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              aria-label={t('sort_by', 'Sort by')}
              className="h-[40px] px-[8px] rounded-[8px] bg-newBgColorInner border border-newTextColor/10 outline-none"
            >
              <option value="newest">{t('sort_newest', 'Newest')}</option>
              <option value="oldest">{t('sort_oldest', 'Oldest')}</option>
              <option value="name-asc">
                {t('sort_name_asc', 'Name (A-Z)')}
              </option>
              <option value="name-desc">
                {t('sort_name_desc', 'Name (Z-A)')}
              </option>
              <option value="size-desc">
                {t('sort_size_desc', 'Size (Largest)')}
              </option>
              <option value="size-asc">
                {t('sort_size_asc', 'Size (Smallest)')}
              </option>
            </select>
            <div className="flex h-[40px] rounded-[8px] border border-newTextColor/10 overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={clsx(
                  'px-[12px] cursor-pointer',
                  viewMode === 'grid' ? 'bg-forth text-white' : 'text-textColor'
                )}
              >
                {t('view_grid', 'Grid')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={clsx(
                  'px-[12px] cursor-pointer',
                  viewMode === 'list' ? 'bg-forth text-white' : 'text-textColor'
                )}
              >
                {t('view_list', 'List')}
              </button>
            </div>
          </div>
        )}
        <div className="w-full pointer-events-none relative mt-[5px] mb-[5px]">
          <div className="w-full h-[46px] overflow-hidden absolute left-0 bg-newBgColorInner uppyChange">
            <Dashboard
              height={46}
              uppy={uppy}
              id={`uploader`}
              showProgressDetails={true}
              hideUploadButton={true}
              hideRetryButton={true}
              hidePauseResumeButton={true}
              hideCancelButton={true}
              hideProgressAfterFinish={true}
            />
          </div>
          <div className="w-full h-[46px] uppyChange" />
        </div>
        <div
          className={clsx(
            'flex-1 relative',
            !isLoading &&
              !data?.results?.length &&
              'bg-newTextColor/[0.02] rounded-[12px]'
          )}
        >
          <div
            className={clsx(
              'absolute -left-[3px] -top-[3px] withp3 h-full overflow-x-hidden overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner',
              !isLoading &&
                !data?.results?.length &&
                'flex justify-center items-center gap-[20px] flex-col'
            )}
          >
            {!isLoading && !data?.results?.length && (
              <>
                <NoMediaIcon />
                <div className="text-[20px] font-[600]">
                  You don't have any media yet
                </div>
                <div className="whitespace-pre-line text-newTextColor/[0.6] text-center">
                  Select or upload pictures (maximum 10 at a time). {'\n'}
                  You can also drag & drop pictures.
                </div>
                <div className="forceChange">{btn}</div>
              </>
            )}
            {isLoading && (
              <>
                {[...new Array(16)].map((_, i) => (
                  <div
                    className={clsx(
                      'px-[3px] py-[3px] float-left rounded-[6px] cursor-pointer w8-max aspect-square'
                    )}
                    key={i}
                  >
                    <div className="w-full h-full bg-newSep rounded-[6px] animate-pulse" />
                  </div>
                ))}
              </>
            )}
            {!isLoading && !!data?.results?.length && !visibleMedia.length && (
              <div className="text-newTextColor/[0.6]">
                {t('no_media_match_search', 'No media matches your search')}
              </div>
            )}
            {viewMode === 'list' && !isLoading && (
              <div className="flex flex-col gap-[6px] w-full p-[2px]">
                {visibleMedia.map((media: any) => {
                  const isSelected = selected.some(
                    (p: any) => p.id === media.id
                  );
                  return (
                    <div
                      key={media.id}
                      onClick={addRemoveSelected(media)}
                      className={clsx(
                        'group flex items-center gap-[12px] p-[6px] rounded-[8px] border-[2px]',
                        !standalone && 'cursor-pointer',
                        isSelected
                          ? 'border-[#612BD3]'
                          : 'border-transparent hover:bg-newSep'
                      )}
                    >
                      <div className="w-[48px] h-[48px] shrink-0 rounded-[6px] overflow-hidden">
                        {media.path.indexOf('mp4') > -1 ? (
                          <VideoFrame url={mediaDirectory.set(media.path)} />
                        ) : (
                          <img
                            width="100%"
                            height="100%"
                            className="w-full h-full object-cover"
                            src={mediaDirectory.set(media.path)}
                            alt="media"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-[14px]">{media.name}</div>
                        <div className="text-[12px] text-newTextColor/[0.6]">
                          {formatBytes(media.fileSize)} ·{' '}
                          {new Date(media.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="flex justify-center items-center text-[14px] font-[500] w-[24px] h-[24px] rounded-full bg-[#612BD3]">
                          {selected.findIndex((z: any) => z.id === media.id) +
                            1}
                        </div>
                      )}
                      {!standalone && !isSelected && (
                        <DeleteCircleIcon
                          className="cursor-pointer shrink-0"
                          onClick={deleteImage(media)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {viewMode === 'grid' &&
              visibleMedia.map((media: any) => (
                <div
                  className={clsx(
                    'group px-[3px] py-[3px] float-left rounded-[6px] w8-max aspect-square',
                    !standalone && 'cursor-pointer'
                  )}
                  key={media.id}
                >
                  <div
                    className={clsx(
                      'w-full h-full rounded-[6px] border-[4px] relative',
                      !!selected.find((p) => p.id === media.id)
                        ? 'border-[#612BD3]'
                        : 'border-transparent'
                    )}
                    onClick={addRemoveSelected(media)}
                  >
                    {!!selected.find((p: any) => p.id === media.id) ? (
                      <div className="flex justify-center items-center text-[14px] font-[500] w-[24px] h-[24px] rounded-full bg-[#612BD3] absolute -bottom-[10px] -end-[10px] z-[10]">
                        {selected.findIndex((z: any) => z.id === media.id) + 1}
                      </div>
                    ) : (
                      <DeleteCircleIcon
                        className="cursor-pointer hidden z-[100] group-hover:block absolute -top-[5px] -end-[5px]"
                        onClick={deleteImage(media)}
                      />
                    )}
                    <div className="w-full h-full rounded-[6px] overflow-hidden">
                      {media.path.indexOf('mp4') > -1 ? (
                        <VideoFrame url={mediaDirectory.set(media.path)} />
                      ) : (
                        <img
                          width="100%"
                          height="100%"
                          className="w-full h-full object-cover"
                          src={mediaDirectory.set(media.path)}
                          alt="media"
                        />
                      )}
                    </div>
                    <div
                      className="absolute bottom-0 inset-x-0 px-[6px] py-[2px] text-[11px] text-white truncate bg-black/60 rounded-b-[6px]"
                      title={media.name}
                    >
                      {media.name}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
        {(data?.pages || 0) > 1 && (
          <Pagination
            current={page}
            totalPages={data?.pages}
            setPage={setPage}
          />
        )}
        {!standalone && (
          <div className="flex justify-end mt-[32px] gap-[8px]">
            <button
              onClick={() => modals.closeCurrent()}
              className="cursor-pointer h-[52px] px-[20px] items-center justify-center border border-newTextColor/10 flex rounded-[10px]"
            >
              Cancel
            </button>
            {!standalone && selected.length > 0 && (
              <button
                onClick={deleteSelected}
                className="cursor-pointer h-[52px] px-[20px] items-center justify-center border border-red-500/60 text-red-400 flex rounded-[10px]"
              >
                {t('delete_selected', 'Delete selected')} ({selected.length})
              </button>
            )}
            {!isLoading && !!data?.results?.length && (
              <button
                onClick={standalone ? () => {} : addMedia}
                disabled={selected.length === 0}
                className="cursor-pointer text-white disabled:opacity-80 disabled:cursor-not-allowed h-[52px] px-[20px] items-center justify-center bg-[#612BD3] flex rounded-[10px]"
              >
                {t('add_selected_media', 'Add selected media')}
              </button>
            )}
          </div>
        )}
      </div>
    </DropFiles>
  );
};
const formatBytes = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : n >= 1024
    ? `${Math.round(n / 1024)} KB`
    : `${n} B`;
export const MultiMediaComponent: FC<{
  label: string;
  description: string;
  dummy: boolean;
  allData: {
    content: string;
    id?: string;
    image?: Array<{
      id: string;
      path: string;
    }>;
  }[];
  value?: Array<{
    path: string;
    id: string;
  }>;
  text: string;
  name: string;
  error?: any;
  onOpen?: () => void;
  onClose?: () => void;
  toolBar?: React.ReactNode;
  information?: React.ReactNode;
  onChange: (event: {
    target: {
      name: string;
      value?: Array<{
        id: string;
        path: string;
        alt?: string;
        thumbnail?: string;
        thumbnailTimestamp?: number;
      }>;
    };
  }) => void;
}> = (props) => {
  const {
    name,
    error,
    text,
    onChange,
    value,
    allData,
    dummy,
    toolBar,
    information,
  } = props;
  const user = useUser();
  const modals = useModals();
  useEffect(() => {
    if (value) {
      setCurrentMedia(value);
    }
  }, [value]);

  const [currentMedia, setCurrentMedia] = useState(value);
  const mediaDirectory = useMediaDirectory();
  const changeMedia = useCallback(
    (
      m:
        | {
            path: string;
            id: string;
          }
        | {
            path: string;
            id: string;
          }[]
    ) => {
      const mediaArray = Array.isArray(m) ? m : [m];
      const newMedia = [...(currentMedia || []), ...mediaArray];
      setCurrentMedia(newMedia);
      onChange({
        target: {
          name,
          value: newMedia,
        },
      });
    },
    [currentMedia]
  );
  const showModal = useCallback(() => {
    modals.openModal({
      title: 'Media Library',
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: 'calc(100% - 80px)',
      height: 'calc(100% - 80px)',
      children: (close) => (
        <MediaBox setMedia={changeMedia} closeModal={close} />
      ),
    });
  }, [changeMedia]);

  const clearMedia = useCallback(
    (topIndex: number) => () => {
      const newMedia = currentMedia?.filter((f, index) => index !== topIndex);
      setCurrentMedia(newMedia);
      onChange({
        target: {
          name,
          value: newMedia,
        },
      });
    },
    [currentMedia]
  );

  const designMedia = useCallback(() => {
    if (!!user?.tier?.ai && !dummy) {
      modals.openModal({
        askClose: false,
        title: 'Design Media',
        size: '80%',
        children: (close) => (
          <Polonto setMedia={changeMedia} closeModal={close} />
        ),
      });
    }
  }, [changeMedia]);

  const t = useT();

  return (
    <>
      <div className="b1 flex flex-col gap-[8px] rounded-bl-[8px] select-none w-full">
        <div className="flex gap-[10px] px-[12px]">
          {!!currentMedia && (
            <ReactSortable
              list={currentMedia}
              setList={(value) =>
                onChange({ target: { name: 'upload', value } })
              }
              className="flex gap-[10px] sortable-container"
              animation={200}
              swap={true}
              handle=".dragging"
            >
              {currentMedia.map((media, index) => (
                <Fragment key={media.id}>
                  <div className="cursor-pointer rounded-[5px] w-[40px] h-[40px] border-2 border-tableBorder relative flex transition-all">
                    <DragHandleIcon className="z-[20] dragging absolute pe-[1px] pb-[3px] -start-[4px] -top-[4px] cursor-move" />

                    <div className="w-full h-full relative group">
                      <div
                        onClick={async () => {
                          modals.openModal({
                            title: 'Media Settings',
                            children: (close) => (
                              <MediaComponentInner
                                media={media as any}
                                onClose={close}
                                onSelect={(value: any) => {
                                  onChange({
                                    target: {
                                      name: 'upload',
                                      value: currentMedia.map((p) => {
                                        if (p.id === media.id) {
                                          return {
                                            ...p,
                                            ...value,
                                          };
                                        }
                                        return p;
                                      }),
                                    },
                                  });
                                }}
                              />
                            ),
                          });
                        }}
                        className="absolute top-[50%] left-[50%] -translate-x-[50%] -translate-y-[50%] bg-black/80 rounded-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-[9]"
                      >
                        <MediaSettingsIcon className="cursor-pointer relative z-[200]" />
                      </div>
                      {media?.path?.indexOf('mp4') > -1 ? (
                        <VideoFrame url={mediaDirectory.set(media?.path)} />
                      ) : (
                        <img
                          className="w-full h-full object-cover rounded-[4px]"
                          src={mediaDirectory.set(media?.path)}
                        />
                      )}
                    </div>

                    <CloseCircleIcon
                      onClick={clearMedia(index)}
                      className="absolute -end-[4px] -top-[4px] z-[20] rounded-full bg-white"
                    />
                  </div>
                </Fragment>
              ))}
            </ReactSortable>
          )}
        </div>
        {!dummy && (
          <div className="flex gap-[8px] px-[12px] border-t border-newColColor w-full b1 text-textColor">
            <div className="flex py-[10px] b2 items-center gap-[4px]">
              <div
                onClick={showModal}
                className="cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]"
              >
                <div className="flex gap-[8px] items-center">
                  <div>
                    <InsertMediaIcon />
                  </div>
                  <div className="text-[10px] font-[600] maxMedia:hidden block">
                    {t('insert_media', 'Insert Media')}
                  </div>
                </div>
              </div>
              <div
                onClick={designMedia}
                className="cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]"
              >
                <div className="flex gap-[5px] items-center">
                  <div>
                    <DesignMediaIcon />
                  </div>
                  <div className="text-[10px] font-[600] iconBreak:hidden block">
                    {t('design_media', 'Design Media')}
                  </div>
                </div>
              </div>

              <ThirdPartyMedia allData={allData} onChange={changeMedia} />

              {!!user?.tier?.ai && (
                <>
                  <AiImage value={text} onChange={changeMedia} />
                  <AiVideo value={text} onChange={changeMedia} />
                </>
              )}
            </div>
            <div className="text-newColColor h-full flex items-center">
              <VerticalDividerIcon />
            </div>
            {!!toolBar && (
              <div className="flex py-[10px] b2 items-center gap-[4px]">
                {toolBar}
              </div>
            )}
            {information && (
              <div className="flex-1 justify-end flex py-[10px] b2 items-center gap-[4px]">
                {information}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="text-[12px] text-red-400">{error}</div>
    </>
  );
};
export const MediaComponent: FC<{
  label: string;
  description: string;
  value?: {
    path: string;
    id: string;
  };
  name: string;
  onChange: (event: {
    target: {
      name: string;
      value?: {
        id: string;
        path: string;
      };
    };
  }) => void;
  type?: 'image' | 'video';
  width?: number;
  height?: number;
}> = (props) => {
  const t = useT();

  const { name, type, label, description, onChange, value, width, height } =
    props;
  const { getValues } = useSettings();
  const user = useUser();
  useEffect(() => {
    const settings = getValues()[props.name];
    if (settings) {
      setCurrentMedia(settings);
    }
  }, []);
  const [modal, setShowModal] = useState(false);
  const [mediaModal, setMediaModal] = useState(false);
  const [currentMedia, setCurrentMedia] = useState(value);
  const mediaDirectory = useMediaDirectory();
  const closeDesignModal = useCallback(() => {
    setMediaModal(false);
  }, [modal]);
  const showDesignModal = useCallback(() => {
    setMediaModal(true);
  }, [modal]);
  const changeMedia = useCallback((m: { path: string; id: string }[]) => {
    setCurrentMedia(m[0]);
    onChange({
      target: {
        name,
        value: m[0],
      },
    });
  }, []);
  const showModal = useCallback(() => {
    setShowModal(!modal);
  }, [modal]);
  const clearMedia = useCallback(() => {
    setCurrentMedia(undefined);
    onChange({
      target: {
        name,
        value: undefined,
      },
    });
  }, [value]);
  return (
    <div className="flex flex-col gap-[8px]">
      {modal && (
        <MediaBox setMedia={changeMedia} closeModal={showModal} type={type} />
      )}
      {mediaModal && !!user?.tier?.ai && (
        <Polonto
          width={width}
          height={height}
          setMedia={changeMedia}
          closeModal={closeDesignModal}
        />
      )}
      <div className="text-[14px]">{label}</div>
      <div className="text-[12px]">{description}</div>
      {!!currentMedia && (
        <div className="my-[20px] cursor-pointer w-[200px] h-[200px] border-2 border-tableBorder">
          <img
            className="w-full h-full object-cover"
            src={currentMedia.path}
            onClick={() => window.open(mediaDirectory.set(currentMedia.path))}
          />
        </div>
      )}
      <div className="flex gap-[5px]">
        <Button onClick={showModal}>{t('select', 'Select')}</Button>
        <Button onClick={showDesignModal} className="!bg-customColor45">
          {t('editor', 'Editor')}
        </Button>
        <Button secondary={true} onClick={clearMedia}>
          {t('clear', 'Clear')}
        </Button>
      </div>
    </div>
  );
};
