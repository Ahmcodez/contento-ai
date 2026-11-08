/**
 * Copy and metadata for the public video-downloader pages. One data shape feeds the visible page,
 * the <title>/description and the JSON-LD, so they can never disagree.
 *
 * Writing rules for this file (they matter for search as much as for visitors):
 *  - Every claim must be true of the tool as built: MP4 up to 1080p, MP3 audio, videos up to
 *    60 minutes, files kept about 30 minutes, no account. Do not promise 4K, "no watermark",
 *    "100% safe", speeds or sites that are not in the supported list.
 *  - Be straight about copyright and site terms. That is both the honest thing and what separates
 *    a useful page from the thin, repetitive ones that fill this search space.
 *  - Each page has its own text; do not copy sections between pages.
 *
 * If a limit changes (src/config: TOOL_MAX_DURATION_SECONDS, TOOL_MAX_FILESIZE_MB, TOOL_MAX_HEIGHT,
 * TOOL_FILE_TTL_SECONDS), update the numbers here too.
 */

export const SUPPORTED_SITES = [
  { name: 'YouTube', note: 'Regular videos and Shorts, up to 1080p.', href: '/youtube-video-downloader' },
  { name: 'TikTok', note: 'Public videos, including short vm.tiktok.com links.', href: '/tiktok-video-downloader' },
  { name: 'Vimeo', note: 'Public videos that don’t need a password.', href: '/vimeo-video-downloader' },
  { name: 'Facebook', note: 'Public videos and Reels.', href: null },
  { name: 'Instagram', note: 'Public Reels and video posts.', href: null },
  { name: 'X (Twitter)', note: 'Public posts that contain a video.', href: null },
  { name: 'Dailymotion', note: 'Public videos.', href: null },
  { name: 'Reddit', note: 'Videos hosted on Reddit.', href: null },
];

const COMMON_STEPS = (site) => [
  { title: `Copy the ${site} link`, body: 'Open the video and copy its address from the browser bar, or press the app’s Share button and choose Copy link.' },
  { title: 'Paste it into the box', body: 'Press Get video. We read the title and show only the qualities that really exist for that video.' },
  { title: 'Choose a format and download', body: 'Pick an MP4 quality or MP3 audio, press Download, wait a few seconds while the file is prepared, then tap Download file.' },
];

export const DOWNLOADER_PAGES = {
  hub: {
    path: '/video-downloader',
    breadcrumb: 'Video downloader',
    metaTitle: 'Free Online Video Downloader – MP4 & MP3, No Sign-Up',
    metaDescription:
      'Paste a video link and download it as MP4 or MP3. Works with YouTube, TikTok, Vimeo, Facebook, Instagram, X and more. No account and nothing to install.',
    h1: 'Free online video downloader',
    intro:
      'Paste the link of a video, choose MP4 or MP3, and save the file to your phone or computer. There is no account to create and no software to install. It works with YouTube, TikTok, Vimeo, Facebook, Instagram, X, Dailymotion and Reddit, for videos up to 60 minutes long.',
    placeholder: 'Paste a video link, for example from YouTube or TikTok',
    stepsHeading: 'How to download a video online',
    steps: COMMON_STEPS('video'),
    sections: [
      {
        id: 'supported-sites',
        heading: 'Websites you can download from',
        paragraphs: ['Each site publishes video differently, so what works varies a little. This is what to expect from each one.'],
        sites: true,
      },
      {
        id: 'formats',
        heading: 'MP4 or MP3: choosing the right format',
        paragraphs: [
          'Choose MP4 when you want the picture as well as the sound. The files use the H.264 video and AAC audio combination whenever the site offers it, which plays on practically every phone, TV and computer without extra apps. Choose MP3 when you only need the audio: a talk, a podcast episode, a lecture you want to listen to on a walk.',
          'Higher quality means a bigger file. The sizes below are rough guides for typical videos; the real figure appears next to each option once you paste your link, and it varies a lot with how much movement is on screen.',
        ],
        table: {
          head: ['Quality', 'Good for', 'Roughly per minute'],
          rows: [
            ['1080p', 'Large screens, TVs, anything you will watch closely', '30 to 60 MB'],
            ['720p', 'Most phones and laptops; the best balance of size and sharpness', '15 to 30 MB'],
            ['480p', 'Small screens or slow connections', '8 to 12 MB'],
            ['360p', 'Saving space, long videos you mostly listen to', '4 to 8 MB'],
            ['MP3 audio', 'Music-free talks, interviews, lectures, podcasts', 'About 1 MB'],
          ],
        },
        paragraphs2: ['We stop at 1080p. Videos that exist in higher resolutions are offered at 1080p, and a quality is only listed if the video really has it.'],
      },
      {
        id: 'devices',
        heading: 'Downloading on iPhone, Android, Windows and Mac',
        paragraphs: [
          'It all happens in your browser, so the same steps work everywhere. On an iPhone or iPad, use Safari (iOS 13 or newer): the file is saved to the Downloads folder in the Files app, and you can move it to Photos from there. On Android, Chrome saves it to Downloads and it shows up in your gallery or files app. On Windows and Mac, the file lands in your usual Downloads folder.',
          'If nothing seems to happen when you press Download file, check your browser’s downloads list. Some browsers show the progress there instead of on the page.',
        ],
      },
      {
        id: 'legal',
        heading: 'Is it legal to download online videos?',
        paragraphs: [
          'It depends on the video and on what you do with it, and this is not legal advice. Saving your own videos, public-domain and Creative Commons videos, and videos the owner has said you may save is generally fine. Copyright protects most other videos. Many sites’ terms of service also say downloads should go through the site’s own features, and breaking those terms can lead to consequences from that site even where the law is more relaxed.',
          'The simple rule: download what you own or have permission to keep, use it for yourself, and don’t re-upload or sell other people’s work. If you are a rights holder and something here shouldn’t be, see our acceptable use and copyright page.',
        ],
      },
      {
        id: 'troubleshooting',
        heading: 'If a download doesn’t work',
        bullets: [
          'Private, members-only, age-restricted and password-protected videos can’t be downloaded, because they need a sign-in we don’t have.',
          'Live streams can’t be saved while they are live. Try again after the stream has ended and been published as a normal video.',
          'Videos longer than 60 minutes, or files that would be over 300 MB, are over the free limit. A lower quality or audio-only usually fits.',
          'Some videos are blocked in certain countries. If a site says a video isn’t available in your region, it may not be available from our servers either.',
          'A link to a playlist or channel downloads only the single video in the link. Paste the link of the video itself.',
          'Sites change how they serve video from time to time. If a link that should work fails, try again later; fixes usually follow quickly.',
        ],
      },
      {
        id: 'privacy',
        heading: 'What happens to the file you download',
        paragraphs: [
          'We prepare your file on our server, give you a private link to it, and delete it about 30 minutes later. We don’t build a library of what people download, and you don’t need an account. To prevent abuse we briefly use technical details such as your IP address to apply usage limits.',
        ],
      },
    ],
    faq: [
      { q: 'Is this video downloader really free?', a: 'Yes. There is no charge and no account to create. To keep it working for everyone there are limits on video length, file size and how many downloads one person can start in an hour.' },
      { q: 'Which websites does it support?', a: 'YouTube, TikTok, Vimeo, Facebook, Instagram, X (Twitter), Dailymotion and Reddit. Links from other sites are not accepted, and YouTube Music links are not supported.' },
      { q: 'What is the best quality I can download?', a: 'Up to 1080p MP4, or MP3 for audio only. Only qualities the video actually has are shown, so a video that was uploaded in 480p will not offer 1080p.' },
      { q: 'Can I download just the audio?', a: 'Yes. Choose MP3 after pasting your link. This is useful for talks, interviews and lectures. Respect the rights of musicians and other creators when you save audio.' },
      { q: 'Why does my link say it can’t be downloaded?', a: 'The most common reasons are that the video is private, age-restricted, a live stream, longer than 60 minutes, or unavailable in the region our servers are in.' },
      { q: 'How long is my file available?', a: 'About 30 minutes after it is prepared. After that it is deleted and you would need to start again.' },
      { q: 'Do I need to install anything?', a: 'No. It runs in your browser on phones, tablets and computers.' },
      { q: 'Is it legal to download videos?', a: 'It depends on the video and the use. Your own videos and content you have permission to save are fine; most other videos are protected by copyright and by the site’s terms. This is general information, not legal advice.' },
    ],
  },

  youtube: {
    path: '/youtube-video-downloader',
    breadcrumb: 'YouTube video downloader',
    metaTitle: 'YouTube Video Downloader – Save as MP4 or MP3 Free',
    metaDescription:
      'Download a YouTube video or Short as MP4 (up to 1080p) or MP3 audio. Paste the link, pick a quality and save the file. No account, no software.',
    h1: 'YouTube video downloader',
    intro:
      'Paste a YouTube link, pick a quality, and save the video as an MP4 or just the sound as an MP3. It handles regular videos and Shorts up to 60 minutes long, and nothing needs to be installed.',
    placeholder: 'Paste a YouTube link, for example https://www.youtube.com/watch?v=…',
    stepsHeading: 'How to download a YouTube video',
    steps: [
      { title: 'Copy the video’s address', body: 'On a computer, copy the link from the address bar. In the YouTube app, tap Share, then Copy link.' },
      { title: 'Paste it and press Get video', body: 'We show the title and the qualities this particular video offers, from 144p up to 1080p, plus MP3.' },
      { title: 'Download your file', body: 'Choose a quality, press Download, and when the file is ready tap Download file. It is saved like any other download.' },
    ],
    sections: [
      {
        id: 'links',
        heading: 'Which YouTube links work',
        paragraphs: ['Most normal YouTube addresses are accepted:'],
        bullets: [
          'Standard video links such as youtube.com/watch?v=…',
          'Short links such as youtu.be/…, which is what the Share button gives you',
          'YouTube Shorts links (youtube.com/shorts/…)',
        ],
        paragraphs2: [
          'A link that points into a playlist downloads only the one video it names, not the whole list. YouTube Music links are not supported, and neither are live streams, private videos or videos that need you to confirm your age.',
        ],
      },
      {
        id: 'quality',
        heading: 'Picking a quality for a YouTube video',
        paragraphs: [
          'YouTube stores most videos in several resolutions, and we list the ones that exist for yours. 1080p looks best on a TV or a large monitor; 720p is the sweet spot for phones and laptops and produces a file roughly half the size; 360p is fine when you mainly need the audio and want to save space.',
          'YouTube offers some videos in 1440p, 4K or higher. We stop at 1080p to keep downloads fast and files a manageable size, and the quality list shows only what we can deliver.',
        ],
      },
      {
        id: 'audio',
        heading: 'Saving a YouTube video as MP3',
        paragraphs: [
          'Choosing MP3 gives you the audio track as a standard MP3 file, about a megabyte for every minute. It suits spoken content: interviews, lectures, conference talks, audiobooks that are free to share, and your own recordings. Music is different: most of it is copyrighted, and a download is not a licence to keep or share it.',
        ],
      },
      {
        id: 'official',
        heading: 'YouTube’s own ways to save videos',
        paragraphs: [
          'If the video is yours, the best copy is the original you uploaded. In YouTube Studio, open Content, choose the video’s menu and select Download to get your own upload back. If you want to watch videos offline, YouTube Premium offers downloads inside the YouTube app, which stay available in the app for as long as the subscription and the video do.',
        ],
      },
      {
        id: 'terms',
        heading: 'Copyright and YouTube’s terms',
        paragraphs: [
          'Most YouTube videos belong to their creators, and YouTube’s terms of service say content should be viewed through its own features unless a download option is provided. Use this tool for videos that are yours, that carry a Creative Commons licence, that are in the public domain, or that you have the creator’s permission to save. Please don’t re-upload other people’s work.',
        ],
      },
    ],
    faq: [
      { q: 'Can I download a YouTube Short?', a: 'Yes. Paste the Short’s link the same way as any other video. Shorts are vertical, and the file keeps that shape.' },
      { q: 'Why is 1080p the highest option?', a: 'We cap downloads at 1080p to keep preparation quick and files a reasonable size. A video that was uploaded in a lower resolution will top out lower still.' },
      { q: 'Can I download a whole YouTube playlist?', a: 'No. Each download is a single video. If your link includes a playlist, only the video it points to is used.' },
      { q: 'Why does my YouTube link not work?', a: 'The usual causes are a private or members-only video, an age-restricted video, a live stream, or a video longer than 60 minutes. A video that has been removed will also fail.' },
      { q: 'Does the MP4 have sound?', a: 'Yes. We check that the finished file has an audio track before offering it, and refuse files where the sound was lost.' },
      { q: 'Is there a time limit on YouTube videos?', a: 'Videos up to 60 minutes can be downloaded. Longer ones are over the free limit.' },
      { q: 'Do you keep a copy of the videos I download?', a: 'Your file is deleted from our server about 30 minutes after it is prepared, and we don’t keep a library of downloads.' },
    ],
  },

  tiktok: {
    path: '/tiktok-video-downloader',
    breadcrumb: 'TikTok video downloader',
    metaTitle: 'TikTok Video Downloader – Save TikTok Videos as MP4',
    metaDescription:
      'Paste a TikTok link and save the video as an MP4 to your phone or computer. Free, no sign-up, nothing to install.',
    h1: 'TikTok video downloader',
    intro:
      'Paste the link of a TikTok video and save it as an MP4 on your phone or computer, or as an MP3 if you only want the sound. No account, no app to install, and it works in your normal browser.',
    placeholder: 'Paste a TikTok link, for example https://www.tiktok.com/@name/video/…',
    stepsHeading: 'How to download a TikTok video',
    steps: [
      { title: 'Copy the link in TikTok', body: 'Open the video, tap Share, then Copy link. The short vm.tiktok.com and vt.tiktok.com links that TikTok creates work too.' },
      { title: 'Paste it and press Get video', body: 'We look up the video and show the formats it is available in.' },
      { title: 'Download', body: 'Pick a format, press Download, and tap Download file when it is ready. The video is saved to your Downloads.' },
    ],
    sections: [
      {
        id: 'phone',
        heading: 'Saving TikToks on an iPhone or Android phone',
        paragraphs: [
          'You can do everything from the browser on your phone. On an iPhone, open this page in Safari; the finished video goes to the Downloads folder in the Files app, and from there you can share it or save it to Photos. On Android, Chrome saves it to Downloads and it appears in your gallery shortly after.',
        ],
      },
      {
        id: 'watermark',
        heading: 'About the TikTok logo on saved videos',
        paragraphs: [
          'We save the video that TikTok makes available for the link you give us. Whether that copy carries TikTok’s moving logo and username depends on what TikTok serves for that video, so results vary and we can’t promise either way. If you need a clean copy for something you are publishing, the reliable route is the original file from the creator.',
        ],
      },
      {
        id: 'creators',
        heading: 'Creators: saving your own videos',
        paragraphs: [
          'If you made the video, your own files are the best source: they are the original quality and have no logo. Many creators also turn off downloads on purpose so that others can’t save their videos. Please respect that choice, and only save videos you made or have been given permission to keep.',
        ],
      },
      {
        id: 'works',
        heading: 'What works and what doesn’t',
        bullets: [
          'Public videos work. Private accounts and videos set to friends only don’t, because they need a sign-in.',
          'Photo slideshows and photo-mode posts may not download as video.',
          'Videos that TikTok hides in certain countries may not be reachable from our servers.',
          'TikTok changes how it serves video fairly often. If a link fails, try again a little later.',
        ],
      },
    ],
    faq: [
      { q: 'Can I save a TikTok without the app?', a: 'Yes. Everything runs in your browser, so you only need the link. The app is just where you copy it from.' },
      { q: 'Does the downloaded TikTok have a watermark?', a: 'It depends on the copy TikTok serves for that video. We can’t promise a watermark-free file.' },
      { q: 'Do the short TikTok links work?', a: 'Yes. Links beginning vm.tiktok.com or vt.tiktok.com work as well as the full ones.' },
      { q: 'Can I download only the sound from a TikTok?', a: 'Yes, choose MP3. Sounds are often music, which is protected by copyright, so treat the file as for your own listening.' },
      { q: 'Why can’t I download a particular TikTok?', a: 'It may be private, from a private account, a photo post, or unavailable in our servers’ region. Try another video to check the link format is right.' },
      { q: 'Is it free?', a: 'Yes. There is no charge and no account. To keep it fair for everyone there is a limit on how many downloads one person can start per hour.' },
    ],
  },

  vimeo: {
    path: '/vimeo-video-downloader',
    breadcrumb: 'Vimeo video downloader',
    metaTitle: 'Vimeo Video Downloader – Save Public Vimeo Videos',
    metaDescription:
      'Download public Vimeo videos as MP4 or MP3. Paste the link, choose a quality and save the file. No account or software needed.',
    h1: 'Vimeo video downloader',
    intro:
      'Paste the link of a public Vimeo video, choose a quality up to 1080p, and save it as an MP4, or take just the audio as an MP3. No account, no extension, nothing to install.',
    placeholder: 'Paste a Vimeo link, for example https://vimeo.com/123456789',
    stepsHeading: 'How to download a Vimeo video',
    steps: [
      { title: 'Copy the Vimeo link', body: 'Copy the address of the page the video is on, such as vimeo.com/123456789.' },
      { title: 'Paste it and press Get video', body: 'We read the title and list the qualities available for the video.' },
      { title: 'Choose and download', body: 'Pick MP4 or MP3, press Download and tap Download file once it is ready.' },
    ],
    sections: [
      {
        id: 'what-works',
        heading: 'Which Vimeo videos can be downloaded',
        paragraphs: ['Vimeo gives creators a lot of control over who can see a video, and that decides what we can reach:'],
        bullets: [
          'Public videos work.',
          'Password-protected videos don’t, because we don’t have the password.',
          'Videos set to private, limited to certain people, or restricted to being embedded on particular sites don’t work.',
          'Paid rentals and purchases on Vimeo On Demand are not available here.',
        ],
      },
      {
        id: 'official',
        heading: 'Check for Vimeo’s own download button first',
        paragraphs: [
          'Many Vimeo creators switch on a download button for their videos. When one is there, it is often the best choice, because it can give you the original file the creator uploaded, in its original quality. Look for a Download option under the player. If it isn’t there, the creator has chosen not to offer one, and that choice should be respected.',
        ],
      },
      {
        id: 'quality',
        heading: 'Quality and file size',
        paragraphs: [
          'Vimeo is popular with filmmakers, and its videos often carry a higher bitrate than the same resolution elsewhere, so a Vimeo file can be noticeably bigger. We list the qualities the video really has, up to 1080p, with an estimated size beside each. Videos over 60 minutes, or files larger than 300 MB, are outside the free limit; a lower quality or audio only usually brings them inside.',
        ],
      },
      {
        id: 'own',
        heading: 'Downloading your own Vimeo videos',
        paragraphs: [
          'If you uploaded the video, you can download your original from your Vimeo account, and you can allow downloads for viewers in the video’s settings. That route is the best one for your own work: no re-compression and no length limits from us.',
        ],
      },
    ],
    faq: [
      { q: 'Can I download a private Vimeo video?', a: 'No. Private, password-protected and embed-restricted videos need an access we don’t have.' },
      { q: 'What quality can I get from Vimeo?', a: 'Up to 1080p MP4, as far as the video itself offers it, or MP3 for audio only.' },
      { q: 'Why is my Vimeo file so large?', a: 'Vimeo videos are often encoded at a higher bitrate, which gives better quality and bigger files. Choose a lower quality to shrink it.' },
      { q: 'Is there a length limit for Vimeo videos?', a: 'Yes, 60 minutes for the free downloader.' },
      { q: 'Do I need a Vimeo account?', a: 'No, and you don’t need an account with us either.' },
    ],
  },
};

export const DOWNLOADER_LINKS = [
  { href: '/video-downloader', label: 'Video downloader' },
  { href: '/youtube-video-downloader', label: 'YouTube video downloader' },
  { href: '/tiktok-video-downloader', label: 'TikTok video downloader' },
  { href: '/vimeo-video-downloader', label: 'Vimeo video downloader' },
];
