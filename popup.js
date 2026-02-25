'use strict';

const exportButton = document.getElementById('exportBtn');
const statusNode = document.getElementById('status');

const COURSE_PAGE_RE = /^https:\/\/frontendmasters\.com\/courses\/[^/?#]+\/?/i;

/**
 * @typedef {Object} LessonData
 * @property {number} [id]
 * @property {string} [title]
 * @property {string} [duration]
 * @property {string} [lessonUrl]
 */

/**
 * @typedef {Object} ExtractedPayload
 * @property {LessonData[]} [lessons]
 */

/**
 * @typedef {Object} ExtractCourseDataResult
 * @property {string} slug
 * @property {ExtractedPayload} payload
 */

/**
 * Updates popup status text and optional error styling.
 *
 * @param {string} message
 * @param {boolean} [isError]
 * @returns {void}
 */
function setStatus(message, isError) {
  statusNode.textContent = message;
  statusNode.classList.toggle('error', Boolean(isError));
}

/**
 * Returns currently active tab in the current window.
 *
 * @returns {Promise<chrome.tabs.Tab | null>}
 */
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

/**
 * Checks whether a URL belongs to a Frontend Masters course page.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
function isCoursePageUrl(url) {
  return typeof url === 'string' && COURSE_PAGE_RE.test(url);
}

/**
 * Ensures the active tab is a valid Frontend Masters course page.
 *
 * @param {chrome.tabs.Tab | null} tab
 * @throws {Error}
 * @returns {chrome.tabs.Tab & {id: number, url: string}}
 */
function assertValidCourseTab(tab) {
  if (!tab || typeof tab.id !== 'number') {
    throw new Error('Active tab not found.');
  }

  if (!isCoursePageUrl(tab.url)) {
    throw new Error(
      'A Frontend Masters course page must be open in the active tab.',
    );
  }

  return /** @type {chrome.tabs.Tab & {id: number, url: string}} */ (tab);
}

/**
 * Converts unknown errors into readable messages.
 *
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || '');
}

/**
 * Detects missing receiver errors from `chrome.tabs.sendMessage`.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingReceiverError(error) {
  const message = getErrorMessage(error);
  return message.includes('Receiving end does not exist');
}

/**
 * Indicates whether `chrome.scripting.executeScript` can be used.
 *
 * @returns {boolean}
 */
function canUseScriptingApi() {
  return Boolean(
    chrome.scripting && typeof chrome.scripting.executeScript === 'function',
  );
}

/**
 * Reloads the given tab and resolves when Chrome reports completion.
 *
 * @param {number} tabId
 * @returns {Promise<void>}
 */
function reloadTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, {}, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

/**
 * Waits until a tab reaches `complete` status, with timeout.
 *
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          'Tab reload timed out. Please reload the page manually and try again.',
        ),
      );
    }, timeoutMs);

    /**
     * Clears listeners and timeout once the wait is finished.
     *
     * @returns {void}
     */
    function cleanup() {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    /**
     * Handles tab update events and resolves when target tab is complete.
     *
     * @param {number} updatedTabId
     * @param {chrome.tabs.TabChangeInfo} changeInfo
     * @returns {void}
     */
    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * Reloads and waits for the active tab to finish loading.
 *
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function refreshTabAndWait(tabId) {
  await reloadTab(tabId);
  await waitForTabComplete(tabId, 15000);
}

/**
 * Validates content script response and returns parsed payload.
 *
 * @param {{ok?: boolean, error?: string, data?: ExtractCourseDataResult} | undefined} response
 * @throws {Error}
 * @returns {ExtractCourseDataResult}
 */
function parseExtractResponse(response) {
  if (!response || !response.ok) {
    throw new Error(
      response && response.error ? response.error : 'Could not read page data.',
    );
  }
  return response.data;
}

/**
 * Creates the v2 task format from extracted lesson data.
 *
 * @param {ExtractedPayload | null | undefined} payload
 * @returns {{tasks: {content: string, description: string}[]}}
 */
function buildV2Payload(payload) {
  const lessons = Array.isArray(payload && payload.lessons)
    ? payload.lessons
    : [];

  return {
    tasks: lessons.map((lesson) => {
      const id = lesson && lesson.id !== undefined ? String(lesson.id) : '';
      const title = lesson && lesson.title ? String(lesson.title) : '';
      const duration = lesson && lesson.duration ? String(lesson.duration) : '';
      const lessonUrl =
        lesson && lesson.lessonUrl ? String(lesson.lessonUrl) : '';

      return {
        content: `${id}. ${title} []`,
        description: `- Duration: ${duration} min\n- Url: ${lessonUrl}`,
      };
    }),
  };
}

/**
 * Requests course payload from the active tab.
 *
 * @param {chrome.tabs.Tab | null} tab
 * @throws {Error}
 * @returns {Promise<ExtractCourseDataResult>}
 */
async function requestCourseData(tab) {
  const courseTab = assertValidCourseTab(tab);

  try {
    const response = await chrome.tabs.sendMessage(courseTab.id, {
      type: 'extract-course-data',
    });
    return parseExtractResponse(response);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    if (canUseScriptingApi()) {
      await chrome.scripting.executeScript({
        target: { tabId: courseTab.id },
        files: ['content.js'],
      });
    } else {
      await refreshTabAndWait(courseTab.id);
    }

    const retryResponse = await chrome.tabs.sendMessage(courseTab.id, {
      type: 'extract-course-data',
    });
    return parseExtractResponse(retryResponse);
  }
}

/**
 * Saves JSON file into user-selected directory.
 *
 * @param {FileSystemDirectoryHandle} rootDirHandle
 * @param {string} fileName
 * @param {unknown} payload
 * @returns {Promise<void>}
 */
async function saveWithDirectoryPicker(rootDirHandle, fileName, payload) {
  const fileHandle = await rootDirHandle.getFileHandle(fileName, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

/**
 * Saves JSON file with browser downloads API.
 *
 * @param {string} fileName
 * @param {unknown} payload
 * @returns {Promise<void>}
 */
async function saveWithDownload(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const blobUrl = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({
      url: blobUrl,
      filename: fileName,
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  }
}

/**
 * Handles export button click flow.
 *
 * @returns {Promise<void>}
 */
async function onExportClick() {
  exportButton.disabled = true;

  try {
    setStatus('Checking active page...');
    const activeTab = assertValidCourseTab(await getActiveTab());

    let chosenRootDirectory = null;
    if ('showDirectoryPicker' in window) {
      setStatus('Select project folder...');
      chosenRootDirectory = await window.showDirectoryPicker({
        mode: 'readwrite',
      });
    }

    setStatus('Reading course data...');
    const { slug, payload } = await requestCourseData(activeTab);
    const v2Payload = buildV2Payload(payload);
    const baseFileName = `${slug}.json`;
    const v2FileName = `${slug}-v2.json`;

    if (chosenRootDirectory) {
      await saveWithDirectoryPicker(chosenRootDirectory, baseFileName, payload);
      await saveWithDirectoryPicker(chosenRootDirectory, v2FileName, v2Payload);
      setStatus(`✅ Saved: ${baseFileName}, ${v2FileName}`);
      return;
    }

    await saveWithDownload(baseFileName, payload);
    await saveWithDownload(v2FileName, v2Payload);
    setStatus(`✅ Downloaded: ${baseFileName}, ${v2FileName}`);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      setStatus('⚠️ Folder selection was cancelled.');
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error.';
      setStatus(`❌ ${message}`, true);
    }
  } finally {
    exportButton.disabled = false;
  }
}

exportButton.addEventListener('click', onExportClick);
