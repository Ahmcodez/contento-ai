import DownloaderPage, { downloaderMetadata } from '@/components/downloader/DownloaderPage';
import { DOWNLOADER_PAGES } from '@/lib/downloaderPages';

const page = DOWNLOADER_PAGES.tiktok;

export const metadata = downloaderMetadata(page);

export default function Page() {
  return <DownloaderPage page={page} />;
}
