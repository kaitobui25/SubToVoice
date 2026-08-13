# SubToVoice

Chrome / Microsoft Edge extension that reads the subtitles currently rendered by YouTube and turns them into buffered speech.

## Flow

YouTube captions -> rolling-caption dedupe -> short phrase buffer -> browser TTS queue -> pause video if speech falls behind -> resume after the queue is empty.

The extension reads rendered captions instead of YouTube private subtitle endpoints. To hear Vietnamese, select YouTube CC / Auto-translate to Vietnamese first.

## Install

1. Download or clone this repository branch.
2. Open `edge://extensions` or `chrome://extensions`.
3. Enable Developer mode and choose Load unpacked.
4. Select this repository folder.
5. Open a YouTube video and enable CC.
6. Open the SubToVoice popup once. It stores `enabled=true` and starts reading visible captions.

Defaults: Vietnamese TTS, 0.7 s phrase buffer, 1.25x speech rate, pause-video-when-behind enabled, original-audio ducking enabled.

## Development

No runtime dependencies are required. The text buffer and speech queue are plain JavaScript.

Local validation used:

```bash
npm test
npm run check
```

## Privacy

Subtitle text stays in the browser. SubToVoice does not call an AI or translation API. If YouTube Auto-translate is selected, YouTube performs that translation before SubToVoice reads the rendered text.
