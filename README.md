# Course JSON Exporter

A small Chrome extension that extracts data from FrontendMasters course pages and saves JSON files locally.

## Output

- `<course-slug>.json`
- `<course-slug>-v2.json`

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.

## Use

1. Open a course page: `https://frontendmasters.com/courses/<course-slug>/`.
2. Click the extension icon.
3. Click **Extract And Save**.
4. Select a folder.

## Notes

- Lesson and section IDs follow page order.
- Durations are saved as minute strings.
- If folder picker is unavailable, files are downloaded to `Downloads/`.
