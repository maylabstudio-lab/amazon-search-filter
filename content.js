// Amazon.co.jp 用 content script
//
// 1. すべての amazon.co.jp ページに、折りたためるオプションパネルを常時表示する
//    （拡張機能アイコンを押さなくても、その場で設定を変えて検索・再検索できる）。
//    パネルの項目・既定値はポップアップ（popup.html/popup.js）と完全に一致させ、
//    どちらから変更しても chrome.storage.sync 経由で即座に反映されるようにする。
// 2. 検索結果ページ（/s）では、次のいずれかに該当する出品を
//      - 「正規品に絞る」ON                    → 隠し、パネルに「N件を非表示」と「すべて表示」を出す
//      - 「カートに入れる」が無い商品を非表示 ON  → 同上（別設定として独立に判定）
//      - 「本日中にお届け」がない商品を非表示 ON  → 同上（別設定として独立に判定）
//      - OFF                                    → 隠さず注意ラベルだけ付ける
//    a. 禁止ワードを含む／商品名の先頭が宣伝文句・装飾記号・メーカー名なしの検索語
//       そのもの（Amazon の商品名規約 ブランド名＋商品名＋仕様 に反する）
//    b. 「カートに入れる」ボタンが無く、オプション選択が必要などですぐに購入できない
//    c. 検索結果カードの配送日情報ブロックに「本日」が含まれない（配送日表示自体が
//       見つからない場合も対象外とみなす。ユーザーの住所・時間帯に依存する動的な表示の
//       ため、Amazon の検索URLパラメータでは絞り込めず、表示されている文言で判定する）
//
// 除外を Amazon の検索クエリ（-キーワード）で行わないのは、amazon.co.jp が
// その構文を安定して解釈せず、結果が 0 件になることがあるため。表示側で隠す方が確実。
//
// Amazon の DOM はクラス名・属性が変わりやすいため、商品セレクタは候補配列で順に試す。

(() => {
  "use strict";

  const LOG_PREFIX = "[Amazon Search Filter]";

  const RESULT_ITEM_SELECTORS = [
    'div[data-component-type="s-search-result"]',
    'div.s-result-item[data-asin]:not([data-asin=""])',
    '.s-main-slot [data-asin]:not([data-asin=""])',
    '[data-asin]:not([data-asin=""])',
  ];

  const TITLE_SELECTORS = [
    "h2 a span",
    "h2 span",
    '[data-cy="title-recipe"] span',
    "a.a-link-normal span.a-text-normal",
    "h2",
  ];

  const RESULTS_CONTAINER_SELECTORS = [
    ".s-main-slot",
    ".s-search-results",
    '[data-component-type="s-search-results"]',
  ];

  // 「カートに入れる」ボタンの候補セレクタ。属性が変わってもボタン文言で拾えるよう
  // itemHasAddToCartButton() 側にテキストでのフォールバックも用意する。
  const ADD_TO_CART_SELECTORS = [
    'input[name="submit.addToCart"]',
    'button[name="submit.addToCart"]',
    '[data-csa-c-slot-id="s-add-to-cart-button"]',
  ];
  const ADD_TO_CART_TEXT = "カートに入れる";

  // 配送日情報（「本日お届け」等）が入るブロックの候補セレクタ。
  // data-cy="title-recipe" と同様、Amazon は配送情報も data-cy="delivery-recipe" で
  // 出すことが多いが、変わっている場合に備えて汎用クラスにもフォールバックする。
  const DELIVERY_SELECTORS = [
    '[data-cy="delivery-recipe"]',
    ".s-align-children-center.a-color-secondary",
    ".a-row.a-size-base.a-color-secondary",
  ];

  const COLLAPSE_KEY = "asf-panel-collapsed";
  const DEBUG = new URL(location.href).searchParams.has("asf_debug");

  // --- 状態 ----------------------------------------------------------------
  // ポップアップ（popup.js）と同じ項目・既定値にして、どちらから操作しても
  // チェック内容が一致するようにする。
  const SETTINGS_DEFAULTS = {
    excludeSuspicious: true,
    genuineEnabled: false,
    genuineCategory: "",
    amazonDirect: false,
    discount: "",
    hideNoCart: false,
    hideNotToday: false,
    showPanel: true,
  };
  let settings = { ...SETTINGS_DEFAULTS };
  let excludeWords = [];
  let observer = null;
  let rescanTimer = null;
  let matchedItemsEver = false;

  const flagged = []; // { item, hits }
  let revealed = false;
  let panel = null;

  const onSearchPage =
    /(^|\/)s(\/|$)/.test(location.pathname) || new URL(location.href).searchParams.has("k");

  // サインイン・購入・決済・アカウント系のページにはパネルを出さない
  const panelAllowedHere =
    !/^\/(ap|gp\/buy|checkout|gp\/css|gp\/payment|gp\/help)\b/.test(location.pathname);

  if (
    typeof getExcludeWords !== "function" ||
    typeof buildSearchUrl !== "function" ||
    typeof titleViolatesPolicy !== "function"
  ) {
    console.warn(LOG_PREFIX, "dictionary.js が読み込まれていません。処理を中止します。");
    return;
  }

  // --- ユーティリティ -----------------------------------------------------
  function firstMatch(root, selectors) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) {
        /* 無効なセレクタは無視 */
      }
    }
    return null;
  }

  function allMatches(root, selectors) {
    for (const sel of selectors) {
      try {
        const els = root.querySelectorAll(sel);
        if (els.length) return { selector: sel, elements: Array.from(els) };
      } catch (_) {
        /* 無効なセレクタは無視 */
      }
    }
    return { selector: null, elements: [] };
  }

  function getItemTitle(item) {
    const el = firstMatch(item, TITLE_SELECTORS);
    return el ? (el.textContent || "").trim() : "";
  }

  // 検索結果内に「カートに入れる」ボタンがあるか判定する。
  // 属性が変わっている場合に備えて、ボタン文言そのものでも判定する。
  function itemHasAddToCartButton(item) {
    for (const sel of ADD_TO_CART_SELECTORS) {
      try {
        if (item.querySelector(sel)) return true;
      } catch (_) {
        /* 無効なセレクタは無視 */
      }
    }
    const candidates = item.querySelectorAll(
      'button, input[type="submit"], span.a-button-text, a.a-button-text'
    );
    for (const el of candidates) {
      const text = String(el.value || el.textContent || "").trim();
      if (text === ADD_TO_CART_TEXT) return true;
    }
    return false;
  }

  // 検索結果内に「本日お届け」等、本日中の配送日表示があるか判定する。
  // 商品タイトル側の「本日限定」等の宣伝文句と誤判定しないよう、配送日ブロックの
  // 中だけを見る（ブロックが見つからない＝配送日表示なしとみなし、本日お届け扱いにしない）。
  function itemArrivesToday(item) {
    const block = firstMatch(item, DELIVERY_SELECTORS);
    if (!block) return false;
    const text = (block.textContent || "").replace(/\s+/g, "");
    return text.includes("本日");
  }

  function saveSettings(patch) {
    Object.assign(settings, patch);
    try {
      chrome.storage.sync.set(patch);
    } catch (err) {
      console.warn(LOG_PREFIX, "設定を保存できません:", err);
    }
  }

  // --- 注意ラベル / 非表示 ---------------------------------------------
  // 1件の出品が複数の理由（禁止ワード／商品名規約違反／カートに入れる不可／
  // 本日お届け対象外）に該当することがあるため、該当する理由をすべて文字列の配列で返す。
  function buildReasons(hits, reason, noCart, notToday) {
    const reasons = [];
    if (hits.length) reasons.push(`非正規品の可能性: 「${hits.join("／")}」を含む表記`);
    if (reason) reasons.push(`商品名がAmazonの表記規則（ブランド名＋商品名＋仕様）に沿っていません（${reason}）`);
    if (noCart) reasons.push("「カートに入れる」ボタンがなく、すぐに購入できない可能性があります");
    if (notToday) reasons.push("本日中にお届けの対象ではない可能性があります");
    return reasons;
  }

  // この出品を非表示にすべきか（該当理由ごとに対応する設定がONか）を判定する。
  function shouldHideEntry(hits, reason, noCart, notToday) {
    return (
      ((hits.length || reason) && settings.excludeSuspicious) ||
      (noCart && settings.hideNoCart) ||
      (notToday && settings.hideNotToday)
    );
  }

  function labelItem(item, hits, reason, noCart, notToday) {
    if (item.querySelector(".asf-warning-label")) return;

    const label = document.createElement("div");
    label.className = "asf-warning-label";
    label.setAttribute("role", "note");
    label.textContent = buildReasons(hits, reason, noCart, notToday).join(" ／ ");

    const anchor = firstMatch(item, ["h2", '[data-cy="title-recipe"]']);
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(label, anchor);
    } else {
      item.insertBefore(label, item.firstChild);
    }
    item.classList.add("asf-flagged");
  }

  function renderFlagged() {
    for (const { item, hits, reason, noCart, notToday } of flagged) {
      const hide = shouldHideEntry(hits, reason, noCart, notToday) && !revealed;
      item.classList.toggle("asf-hidden", hide);
      if (!hide) labelItem(item, hits, reason, noCart, notToday);
    }
    updatePanelStatus();
  }

  function processItems(root) {
    const { elements } = allMatches(root, RESULT_ITEM_SELECTORS);
    if (!elements.length) return;

    const searchKeyword = onSearchPage
      ? new URL(location.href).searchParams.get("k") || ""
      : "";

    for (const item of elements) {
      try {
        if (item.dataset.asfProcessed === "1") continue;

        const title = getItemTitle(item);
        if (!title) continue; // タイトル未読込。処理済みにせず次の変化で再評価する

        item.dataset.asfProcessed = "1";

        const hits = excludeWords.filter((w) => title.includes(w));
        const policy = titleViolatesPolicy(title, searchKeyword);
        const noCart = settings.hideNoCart && !itemHasAddToCartButton(item);
        const notToday = settings.hideNotToday && !itemArrivesToday(item);

        if (DEBUG) {
          console.debug(LOG_PREFIX, "asf_debug", {
            title,
            searchKeyword,
            hits,
            policy,
            noCart,
            notToday,
          });
        }

        if (!hits.length && !policy.violated && !noCart && !notToday) continue;

        flagged.push({ item, hits, reason: policy.reason, noCart, notToday });
        if (shouldHideEntry(hits, policy.reason, noCart, notToday) && !revealed) {
          item.classList.add("asf-hidden");
        } else {
          labelItem(item, hits, policy.reason, noCart, notToday);
        }
      } catch (err) {
        console.warn(LOG_PREFIX, "商品の処理に失敗:", err);
      }
    }
  }

  // --- オプションパネル ------------------------------------------------
  function buildPanel() {
    const el = document.createElement("div");
    el.id = "asf-panel";
    el.innerHTML = [
      '<div class="asf-panel-head">',
      '  <span class="asf-panel-title">正規品フィルタ</span>',
      '  <div class="asf-panel-actions">',
      '    <button type="button" class="asf-panel-collapse" aria-label="開閉">▾</button>',
      '    <button type="button" class="asf-panel-close" aria-label="パネルを閉じる" title="パネルを閉じる（ポップアップからいつでも再表示できます）">×</button>',
      "  </div>",
      "</div>",
      '<div class="asf-panel-body">',
      '  <div class="asf-panel-row">',
      '    <input type="search" class="asf-kw" placeholder="キーワードで検索" autocomplete="off">',
      '    <button type="button" class="asf-search">検索</button>',
      "  </div>",
      '  <label class="asf-check"><input type="checkbox" class="asf-opt-exclude"> 正規品に絞る（規約外の商品名を検索結果で非表示にする）</label>',
      '  <label class="asf-check"><input type="checkbox" class="asf-opt-no-cart"> 「カートに入れる」がない商品を非表示にする（オプション選択が必要な商品など）</label>',
      '  <label class="asf-check"><input type="checkbox" class="asf-opt-today"> 本日中にお届けとなる商品にしぼる</label>',
      '  <label class="asf-check"><input type="checkbox" class="asf-opt-genuine"> 「正規品」「国内正規品」を検索語に追加する</label>',
      '  <label class="asf-check"><input type="checkbox" class="asf-opt-direct"> Amazon.co.jpが販売・発送する商品にしぼる</label>',
      '  <select class="asf-opt-category asf-select"><option value="">カテゴリ: 指定なし</option></select>',
      '  <select class="asf-opt-discount asf-select">',
      '    <option value="">割引率: 指定なし</option>',
      '    <option value="10">割引率: 10%以上</option>',
      '    <option value="20">割引率: 20%以上</option>',
      '    <option value="30">割引率: 30%以上</option>',
      '    <option value="40">割引率: 40%以上</option>',
      '    <option value="50">割引率: 50%以上</option>',
      "  </select>",
      '  <div class="asf-panel-status" hidden></div>',
      '  <a class="asf-support" href="https://buymeacoffee.com/maylab" target="_blank" rel="noopener noreferrer">☕ 開発者を支援</a>',
      '  <p class="asf-affiliate-note">本拡張機能はAmazonアソシエイト・プログラムを使用しています。</p>',
      "</div>",
    ].join("");

    const kw = el.querySelector(".asf-kw");
    const excludeCb = el.querySelector(".asf-opt-exclude");
    const noCartCb = el.querySelector(".asf-opt-no-cart");
    const todayCb = el.querySelector(".asf-opt-today");
    const genuineCb = el.querySelector(".asf-opt-genuine");
    const directCb = el.querySelector(".asf-opt-direct");
    const categorySel = el.querySelector(".asf-opt-category");
    const discountSel = el.querySelector(".asf-opt-discount");

    for (const [key, value] of Object.entries(GENUINE_DICTIONARY.categories)) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = "カテゴリ: " + value.label;
      categorySel.appendChild(opt);
    }

    if (onSearchPage) {
      kw.value = new URL(location.href).searchParams.get("k") || "";
    }

    // 検索条件の付与は dictionary.js（popup.js と共用）に集約し、
    // ポップアップから検索した場合と同じURLになるようにする。
    const doSearch = async () => {
      const term = kw.value.trim();
      if (!term) {
        kw.focus();
        return;
      }
      const url = new URL(buildSearchUrl(term, settings));
      let directParam = null;
      if (settings.amazonDirect) {
        try {
          const definitions = await loadParameterDefinitions();
          directParam = Object.entries(definitions)[0] || null;
        } catch (err) {
          console.warn(LOG_PREFIX, "パラメータ定義を読み込めません:", err);
        }
      }
      applyResultFilters(url, settings, directParam);
      window.location.assign(url.href);
    };
    el.querySelector(".asf-search").addEventListener("click", doSearch);
    kw.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });

    excludeCb.addEventListener("change", () => {
      revealed = false;
      saveSettings({ excludeSuspicious: excludeCb.checked });
      renderFlagged();
    });
    noCartCb.addEventListener("change", () => {
      revealed = false;
      saveSettings({ hideNoCart: noCartCb.checked });
      resetProcessed();
      scan();
    });
    todayCb.addEventListener("change", () => {
      revealed = false;
      saveSettings({ hideNotToday: todayCb.checked });
      resetProcessed();
      scan();
    });
    genuineCb.addEventListener("change", () => {
      saveSettings({ genuineEnabled: genuineCb.checked });
    });
    directCb.addEventListener("change", () => {
      saveSettings({ amazonDirect: directCb.checked });
    });
    categorySel.addEventListener("change", () => {
      saveSettings({ genuineCategory: categorySel.value });
      excludeWords = getExcludeWords(settings.genuineCategory);
      resetProcessed();
      scan();
    });
    discountSel.addEventListener("change", () => {
      saveSettings({ discount: discountSel.value });
    });

    el.querySelector(".asf-panel-collapse").addEventListener("click", () => {
      const collapsed = el.getAttribute("data-collapsed") === "true";
      setCollapsed(el, !collapsed);
    });

    // パネル内に「パネルを表示する」というオン/オフ項目があるのは分かりにくいため、
    // 非表示への切り替えはヘッダーの×ボタンに一本化する。再表示はポップアップから行う。
    el.querySelector(".asf-panel-close").addEventListener("click", () => {
      saveSettings({ showPanel: false });
      ensurePanel();
    });

    let startCollapsed = false;
    try {
      startCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch (_) {
      /* localStorage 不可なら展開状態で開始 */
    }
    setCollapsed(el, startCollapsed);

    return el;
  }

  function setCollapsed(el, collapsed) {
    el.setAttribute("data-collapsed", String(collapsed));
    el.querySelector(".asf-panel-collapse").textContent = collapsed ? "▸" : "▾";
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch (_) {
      /* 保存できなくても動作に影響なし */
    }
  }

  function syncPanelControls() {
    if (!panel) return;
    panel.querySelector(".asf-opt-exclude").checked = settings.excludeSuspicious;
    panel.querySelector(".asf-opt-no-cart").checked = settings.hideNoCart;
    panel.querySelector(".asf-opt-today").checked = settings.hideNotToday;
    panel.querySelector(".asf-opt-genuine").checked = settings.genuineEnabled;
    panel.querySelector(".asf-opt-direct").checked = settings.amazonDirect;
    const sel = panel.querySelector(".asf-opt-category");
    const exists = Array.from(sel.options).some((o) => o.value === settings.genuineCategory);
    sel.value = exists ? settings.genuineCategory : "";
    panel.querySelector(".asf-opt-discount").value = settings.discount || "";
  }

  function updatePanelStatus() {
    if (!panel) return;
    const status = panel.querySelector(".asf-panel-status");
    const count = flagged.length;

    if (!onSearchPage || !count) {
      status.hidden = true;
      status.textContent = "";
      return;
    }
    status.hidden = false;
    status.textContent = "";

    // 「正規品に絞る」と「カートに入れる無しを除外」は独立した設定なので、
    // 該当理由ごとに実際に非表示になる件数／ラベルのみの件数を分けて数える。
    const hideEligible = flagged.filter(({ hits, reason, noCart, notToday }) =>
      shouldHideEntry(hits, reason, noCart, notToday)
    ).length;
    const hiddenCount = revealed ? 0 : hideEligible;
    const labeledCount = count - hiddenCount;

    const text = document.createElement("span");
    const parts = [];
    if (hiddenCount) parts.push(`対象の出品 ${hiddenCount} 件を非表示`);
    if (labeledCount) parts.push(`${labeledCount} 件に注意ラベル`);
    text.textContent = parts.join(" / ");
    status.appendChild(text);

    if (hideEligible) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "asf-reveal";
      toggle.textContent = revealed ? "再度隠す" : "すべて表示";
      toggle.addEventListener("click", () => {
        revealed = !revealed;
        renderFlagged();
      });
      status.appendChild(toggle);
    }
  }

  function ensurePanel() {
    if (!settings.showPanel || !panelAllowedHere) {
      if (panel) {
        panel.remove();
        panel = null;
      }
      return;
    }
    if (panel && document.body.contains(panel)) {
      syncPanelControls();
      updatePanelStatus();
      return;
    }
    panel = buildPanel();
    document.body.appendChild(panel);
    syncPanelControls();
    updatePanelStatus();
  }

  // 判定条件（カテゴリ、カート必須など）が変わったとき、既に判定済みの出品を
  // 再評価できるよう状態をリセットする（重複登録を防ぐため flagged も空にする）。
  function resetProcessed() {
    const { elements } = allMatches(document, RESULT_ITEM_SELECTORS);
    for (const item of elements) {
      delete item.dataset.asfProcessed;
      item.classList.remove("asf-hidden", "asf-flagged");
      const label = item.querySelector(".asf-warning-label");
      if (label) label.remove();
    }
    flagged.length = 0;
  }

  // --- 走査 ---------------------------------------------------------
  function scan() {
    try {
      ensurePanel();
      if (!onSearchPage) return;

      const { elements } = allMatches(document, RESULT_ITEM_SELECTORS);
      if (elements.length) {
        matchedItemsEver = true;
        processItems(document);
      }
      updatePanelStatus();
    } catch (err) {
      console.warn(LOG_PREFIX, "走査中にエラー:", err);
    }
  }

  function run() {
    scan();

    const target =
      (onSearchPage && firstMatch(document, RESULTS_CONTAINER_SELECTORS)) || document.body;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(scan, 200);
    });
    observer.observe(target, { childList: true, subtree: true });

    if (onSearchPage) {
      setTimeout(() => {
        if (!matchedItemsEver) {
          console.warn(
            LOG_PREFIX,
            "検索結果の商品要素が見つかりませんでした。AmazonのDOM構造が変わった可能性があります。"
          );
        }
      }, 5000);
    }
  }

  // --- 起動 -------------------------------------------------------
  try {
    chrome.storage.sync.get({ ...SETTINGS_DEFAULTS }, (stored) => {
      if (chrome.runtime.lastError) {
        console.warn(LOG_PREFIX, "設定の読み込みに失敗:", chrome.runtime.lastError);
      } else {
        settings = stored;
      }
      excludeWords = getExcludeWords(settings.genuineCategory);
      run();
    });
  } catch (err) {
    console.warn(LOG_PREFIX, "storage にアクセスできません。共通設定で実行します:", err);
    excludeWords = getExcludeWords("");
    run();
  }

  // 設定変更（ポップアップやパネルからの保存）を反映
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const keys = [
        "excludeSuspicious",
        "genuineCategory",
        "genuineEnabled",
        "amazonDirect",
        "discount",
        "hideNoCart",
        "hideNotToday",
        "showPanel",
      ];
      if (!keys.some((k) => changes[k])) return;

      for (const k of keys) {
        if (changes[k]) settings[k] = changes[k].newValue;
      }
      excludeWords = getExcludeWords(settings.genuineCategory);
      ensurePanel();
      resetProcessed();
      scan();
    });
  } catch (_) {
    /* onChanged 未対応環境は無視 */
  }
})();
