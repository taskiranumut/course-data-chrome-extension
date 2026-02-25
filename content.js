(function () {
  'use strict';

  if (window.__fmCourseJsonExporterLoaded) {
    return;
  }
  window.__fmCourseJsonExporterLoaded = true;

  /**
   * @typedef {Object} CourseData
   * @property {string} courseTitle
   * @property {string} courseDescription
   * @property {string} tutor
   * @property {string} totalDuration
   * @property {string} publishedDate
   * @property {number} [sectionCount]
   * @property {number} [lessonCount]
   * @property {string} [courseUrl]
   */

  /**
   * @typedef {Object} LessonData
   * @property {number} id
   * @property {string} title
   * @property {string} description
   * @property {string} duration
   * @property {string} timeRange
   * @property {string} lessonUrl
   * @property {number} sectionId
   * @property {string} sectionTitle
   * @property {string} sectionDuration
   */

  /**
   * @typedef {Object} ExtractCoursePayloadResult
   * @property {string} slug
   * @property {{
   *   courseData: CourseData,
   *   lessons: LessonData[]
   * }} payload
   */

  /**
   * Normalizes whitespace and strips invisible zero-width spaces.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function cleanText(value) {
    return (value || '')
      .replace(/\u200b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extracts total duration in minutes from text.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function extractMinutes(value) {
    const text = cleanText(value).toLowerCase();
    if (!text) {
      return '';
    }

    const hoursMatch = text.match(/(\d+)\s*hours?/);
    const minutesMatch = text.match(/(\d+)\s*minutes?/);
    const minShortMatch = text.match(/(\d+)\s*mins?\b/);

    if (hoursMatch || minutesMatch) {
      const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
      const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
      return String(hours * 60 + minutes);
    }

    if (minShortMatch) {
      return String(Number(minShortMatch[1]));
    }

    const fallbackNumber = text.match(/(\d+)/);
    return fallbackNumber ? String(Number(fallbackNumber[1])) : '';
  }

  /**
   * Converts `HH:MM:SS`, `MM:SS`, or `SS` timestamps into seconds.
   *
   * @param {unknown} value
   * @returns {number | null}
   */
  function timestampToSeconds(value) {
    const parts = cleanText(value)
      .split(':')
      .map((item) => Number(item));

    if (!parts.length || parts.some((num) => Number.isNaN(num))) {
      return null;
    }

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return null;
  }

  /**
   * Calculates lesson duration in minutes from a `start-end` time range.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function getDurationFromTimeRange(value) {
    const range = cleanText(value);
    if (!range) {
      return '';
    }

    const parts = range.split('-').map((item) => cleanText(item));
    if (parts.length !== 2) {
      return '';
    }

    const start = timestampToSeconds(parts[0]);
    const end = timestampToSeconds(parts[1]);
    if (start === null || end === null || end < start) {
      return '';
    }

    return String(Math.round((end - start) / 60));
  }

  /**
   * Extracts the course slug from a pathname.
   *
   * @param {string} pathname
   * @returns {string}
   */
  function getCourseSlug(pathname) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] !== 'courses' || parts.length < 2) {
      return '';
    }
    return parts[1];
  }

  /**
   * Resolves a possibly relative URL against the current origin.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function toAbsoluteUrl(value) {
    const href = cleanText(value);
    if (!href) {
      return '';
    }

    try {
      return new URL(href, window.location.origin).href;
    } catch (_error) {
      return '';
    }
  }

  /**
   * Builds the canonical course URL from slug.
   *
   * @param {string} slug
   * @returns {string}
   */
  function buildCourseUrl(slug) {
    if (!slug) {
      return '';
    }
    return `${window.location.origin}/courses/${slug}/`;
  }

  /**
   * Reads the course description from the page.
   *
   * @returns {string}
   */
  function getCourseDescription() {
    const headings = Array.from(document.querySelectorAll('h3'));
    const descriptionHeading = headings.find(
      (item) =>
        cleanText(item.textContent).toLowerCase() === 'course description',
    );

    if (descriptionHeading) {
      const wrapper =
        descriptionHeading.closest('.content') ||
        descriptionHeading.parentElement;
      const paragraph = wrapper ? wrapper.querySelector('p') : null;
      if (paragraph) {
        return cleanText(paragraph.textContent);
      }
    }

    const fallbackParagraph = document.querySelector('.content p');
    return cleanText(fallbackParagraph ? fallbackParagraph.textContent : '');
  }

  /**
   * Extracts the published date label from the page.
   *
   * @returns {string}
   */
  function getPublishedDate() {
    const candidates = Array.from(
      document.querySelectorAll('.group .duration'),
    );
    const publishedNode = candidates.find((node) =>
      cleanText(node.textContent).toLowerCase().includes('published'),
    );

    if (!publishedNode) {
      return '';
    }

    const text = cleanText(publishedNode.textContent);
    const parts = text.split(':');
    if (parts.length > 1) {
      return cleanText(parts.slice(1).join(':'));
    }
    return text;
  }

  /**
   * Normalizes published date to `YYYY-MM-DD`.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function normalizePublishedDate(value) {
    const text = cleanText(value);
    if (!text) {
      return '';
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    const monthMap = {
      january: '01',
      february: '02',
      march: '03',
      april: '04',
      may: '05',
      june: '06',
      july: '07',
      august: '08',
      september: '09',
      october: '10',
      november: '11',
      december: '12',
    };

    const longMonthMatch = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (longMonthMatch) {
      const month = monthMap[longMonthMatch[1].toLowerCase()];
      const day = String(Number(longMonthMatch[2])).padStart(2, '0');
      const year = longMonthMatch[3];

      if (month) {
        return `${year}-${month}-${day}`;
      }
    }

    return '';
  }

  /**
   * Extracts top-level course metadata.
   *
   * @returns {CourseData}
   */
  function extractCourseData() {
    const title = cleanText(
      document.querySelector('.Course-Header-Details h1')?.textContent,
    );
    const description = getCourseDescription();
    const tutor = cleanText(
      document.querySelector('.FM-Round-Thumbnail-Item .text .main a')
        ?.textContent,
    );
    const totalDuration = extractMinutes(
      document.querySelector('.Course-Header-Meta')?.textContent || '',
    );
    const publishedDate = normalizePublishedDate(getPublishedDate());

    return {
      courseTitle: title,
      courseDescription: description,
      tutor,
      totalDuration,
      publishedDate,
    };
  }

  /**
   * Reads a lesson's `start-end` time range text.
   *
   * @param {Element} lessonItem
   * @returns {string}
   */
  function extractTimeRange(lessonItem) {
    const timestampLink = lessonItem.querySelector('a.timestamp');
    if (!timestampLink) {
      return '';
    }

    const spanNodes = timestampLink.querySelectorAll('span');
    if (spanNodes.length === 0) {
      return '';
    }

    return cleanText(spanNodes[0].textContent);
  }

  /**
   * Extracts lesson URL from available anchors.
   *
   * @param {Element} lessonItem
   * @returns {string}
   */
  function extractLessonUrl(lessonItem) {
    const linkNode =
      lessonItem.querySelector('.title a') ||
      lessonItem.querySelector('a.timestamp') ||
      lessonItem.querySelector('a.thumbnail');

    return toAbsoluteUrl(linkNode?.getAttribute('href'));
  }

  /**
   * Builds lesson list with section metadata.
   *
   * @returns {LessonData[]}
   */
  function extractLessons() {
    const sequence = Array.from(
      document.querySelectorAll('.Course-Lesson-Group, ul.Course-Lesson-List'),
    );

    const lessons = [];
    let nextSectionId = 1001;
    let nextLessonId = 1;
    let currentSection = null;

    for (const node of sequence) {
      if (node.matches('.Course-Lesson-Group')) {
        currentSection = {
          id: nextSectionId,
          title: cleanText(node.querySelector('h3')?.textContent),
          duration: extractMinutes(
            node.querySelector('.duration')?.textContent,
          ),
        };
        nextSectionId += 1;
        continue;
      }

      if (!node.matches('ul.Course-Lesson-List')) {
        continue;
      }

      if (!currentSection) {
        currentSection = { id: nextSectionId, title: '', duration: '' };
        nextSectionId += 1;
      }

      const lessonItems = Array.from(
        node.querySelectorAll('li.Course-Lesson-List-Item'),
      );
      for (const lessonItem of lessonItems) {
        const title = cleanText(
          lessonItem.querySelector('.title a')?.textContent,
        );
        const description = cleanText(
          lessonItem.querySelector('.description')?.textContent,
        );
        const timeRange = extractTimeRange(lessonItem);
        const duration = getDurationFromTimeRange(timeRange);
        const lessonUrl = extractLessonUrl(lessonItem);

        lessons.push({
          id: nextLessonId,
          title,
          description,
          duration,
          timeRange,
          lessonUrl,
          sectionId: currentSection.id,
          sectionTitle: currentSection.title,
          sectionDuration: currentSection.duration,
        });

        nextLessonId += 1;
      }
    }

    return lessons;
  }

  /**
   * Extracts full payload used by popup export flow.
   *
   * @throws {Error}
   * @returns {ExtractCoursePayloadResult}
   */
  function extractCoursePayload() {
    const slug = getCourseSlug(window.location.pathname);
    if (!slug) {
      throw new Error('URL is not in /courses/<course-slug>/ format.');
    }

    const courseData = extractCourseData();
    if (!courseData.courseTitle) {
      throw new Error('Course information could not be found on the page.');
    }

    const lessons = extractLessons();
    const sectionIds = new Set(
      lessons
        .map((lesson) => lesson.sectionId)
        .filter((sectionId) => Number.isFinite(sectionId)),
    );

    courseData.sectionCount = sectionIds.size;
    courseData.lessonCount = lessons.length;
    courseData.courseUrl = buildCourseUrl(slug);

    return {
      slug,
      payload: {
        courseData,
        lessons,
      },
    };
  }

  /**
   * Handles popup extraction request messages.
   *
   * @param {{type?: string} | undefined} message
   * @param {chrome.runtime.MessageSender} _sender
   * @param {(response: {ok: boolean, data?: ExtractCoursePayloadResult, error?: string}) => void} sendResponse
   * @returns {boolean | undefined}
   */
  function handleExtractMessage(message, _sender, sendResponse) {
    if (!message || message.type !== 'extract-course-data') {
      return undefined;
    }

    try {
      const data = extractCoursePayload();
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error.',
      });
    }

    return true;
  }

  chrome.runtime.onMessage.addListener(handleExtractMessage);
})();
