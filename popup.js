const form = document.getElementById("search-form");
const keywordInput = document.getElementById("keyword");
const directCheckbox = document.getElementById("amazon-direct");
const discountSelect = document.getElementById("discount");
const excludeSuspiciousCheckbox = document.getElementById("exclude-suspicious");
const hideNoCartCheckbox = document.getElementById("hide-no-cart");
const hideNotTodayCheckbox = document.getElementById("hide-not-today");
const genuineEnabledCheckbox = document.getElementById("genuine-enabled");
const genuineCategorySelect = document.getElementById("genuine-category");
const showPanelCheckbox = document.getElementById("show-panel");

// 永続化する設定の既定値。キーワードは保存しない。
const SETTINGS_DEFAULTS = {
  amazonDirect: false,
  discount: "",
  excludeSuspicious: true,
  hideNoCart: false,
  hideNotToday: false,
  genuineEnabled: false,
  genuineCategory: "",
  showPanel: true,
};

// カテゴリ選択肢を辞書から生成
function populateCategoryOptions() {
  if (typeof GENUINE_DICTIONARY === "undefined") return;
  for (const [key, value] of Object.entries(GENUINE_DICTIONARY.categories)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = value.label;
    genuineCategorySelect.appendChild(option);
  }
}

function currentSettings() {
  return {
    amazonDirect: directCheckbox.checked,
    discount: discountSelect.value,
    excludeSuspicious: excludeSuspiciousCheckbox.checked,
    hideNoCart: hideNoCartCheckbox.checked,
    hideNotToday: hideNotTodayCheckbox.checked,
    genuineEnabled: genuineEnabledCheckbox.checked,
    genuineCategory: genuineCategorySelect.value,
    showPanel: showPanelCheckbox.checked,
  };
}

function applySettings(settings) {
  directCheckbox.checked = settings.amazonDirect;
  discountSelect.value = settings.discount;
  excludeSuspiciousCheckbox.checked = settings.excludeSuspicious;
  hideNoCartCheckbox.checked = settings.hideNoCart;
  hideNotTodayCheckbox.checked = settings.hideNotToday;
  genuineEnabledCheckbox.checked = settings.genuineEnabled;
  showPanelCheckbox.checked = settings.showPanel;
  // 保存済みカテゴリが辞書に存在しない場合に備えて存在チェック
  const hasCategory = Array.from(genuineCategorySelect.options).some(
    (o) => o.value === settings.genuineCategory
  );
  genuineCategorySelect.value = hasCategory ? settings.genuineCategory : "";
}

function saveSettings() {
  try {
    chrome.storage.sync.set(currentSettings());
  } catch (err) {
    console.warn("[Amazon Search Filter] 設定を保存できません:", err);
  }
}

function restoreSettings() {
  try {
    chrome.storage.sync.get(SETTINGS_DEFAULTS, (stored) => {
      if (chrome.runtime.lastError) {
        console.warn("[Amazon Search Filter] 設定を読み込めません:", chrome.runtime.lastError);
        return;
      }
      applySettings(stored);
    });
  } catch (err) {
    console.warn("[Amazon Search Filter] storage にアクセスできません:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  populateCategoryOptions();
  restoreSettings();

  for (const el of [
    directCheckbox,
    discountSelect,
    excludeSuspiciousCheckbox,
    hideNoCartCheckbox,
    hideNotTodayCheckbox,
    genuineEnabledCheckbox,
    genuineCategorySelect,
    showPanelCheckbox,
  ]) {
    el.addEventListener("change", saveSettings);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const keyword = keywordInput.value.trim();
  if (!keyword) {
    keywordInput.focus();
    return;
  }

  // 「正規品」付加語・アソシエイトタグ・発送元/直販/割引の絞り込みは dictionary.js に集約
  const settings = currentSettings();
  const url = new URL(buildSearchUrl(keyword, settings));

  let directParam = null;
  if (settings.amazonDirect) {
    const definitions = await loadParameterDefinitions();
    directParam = Object.entries(definitions)[0] || null;
  }
  applyResultFilters(url, settings, directParam);

  chrome.tabs.create({ url: url.href });
});
