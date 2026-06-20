const REQUESTED_ANALYSIS_ENGINE = new URLSearchParams(window.location.search).get("engine");
const CAN_USE_REMOTE_API = ["http:", "https:"].includes(window.location.protocol);
const ANALYSIS_ENGINE =
  REQUESTED_ANALYSIS_ENGINE === "browser"
    ? "browser"
    : REQUESTED_ANALYSIS_ENGINE === "api" || CAN_USE_REMOTE_API
      ? "api"
      : "browser";
const API_ANALYSIS_ENDPOINT = "/api/palm-analysis";
const DEFAULT_ANALYSIS_ENGINE_LABEL = "釉뚮씪?곗? 遺꾩꽍";
const FALLBACK_ANALYSIS_ENGINE_LABEL = "釉뚮씪?곗? 遺꾩꽍(?泥?";

const state = {
  left: null,
  right: null,
  scores: null,
  analysisEngineLabel: DEFAULT_ANALYSIS_ENGINE_LABEL,
  analysisResult: null,
  quality: {
    left: null,
    right: null,
  },
  handCheck: {
    left: null,
    right: null,
  },
  pendingHand: "left",
  flow: "capture",
  lowQualityConfirmed: false,
  isAnalyzing: false,
  isSharing: false,
  shareBlob: null,
  shareUrl: null,
  deepClickCount: 0,
  sourceReturnTarget: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function bindFile(inputId, hand) {
  const input = $(`#${inputId}`);
  if (!input) return;

  input.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      state[hand] = reader.result;
      state.lowQualityConfirmed = false;
      renderImages();
      await updateHandQuality(hand);
      await updateHandCheck(hand);
      renderStatuses();
      setPipeline(1);
    };
    reader.readAsDataURL(file);
  });
}

function openSourceSheet(hand) {
  state.pendingHand = hand;
  state.sourceReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  updateText("#sourceHandLabel", hand === "left" ? "?쇱넀 ?대?吏" : "?ㅻⅨ???대?吏");
  $("#sourceSheet")?.classList.add("open");
  $("#sourceSheet")?.setAttribute("aria-hidden", "false");
  document.body.classList.add("source-open");
  setTimeout(() => $("#cameraSourceButton")?.focus(), 0);
}

function closeSourceSheet(restoreFocus = true) {
  $("#sourceSheet")?.classList.remove("open");
  $("#sourceSheet")?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("source-open");
  if (restoreFocus) state.sourceReturnTarget?.focus();
  state.sourceReturnTarget = null;
}

function triggerSource(type) {
  const hand = state.pendingHand;
  const inputId = `${hand}${type === "camera" ? "Camera" : "Gallery"}InputMobile`;
  const input = $(`#${inputId}`);
  closeSourceSheet(false);
  if (input) {
    input.value = "";
    input.click();
  }
}

function trapSourceSheetFocus(event) {
  const sheet = $("#sourceSheet");
  if (event.key !== "Tab" || !sheet?.classList.contains("open")) return;

  const focusable = $$(".source-panel button").filter((element) => !element.disabled);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function renderImages() {
  const mobilePreview = $("#mobilePreview");
  const leftMobileThumb = $("#leftMobileThumb");
  const rightMobileThumb = $("#rightMobileThumb");

  if (state.left && leftMobileThumb) leftMobileThumb.src = state.left;
  if (state.right && rightMobileThumb) rightMobileThumb.src = state.right;
  if (mobilePreview) mobilePreview.src = state.right || state.left || "";
}

function renderStatuses() {
  const leftReady = Boolean(state.left);
  const rightReady = Boolean(state.right);
  const step = !leftReady ? "left" : !rightReady ? "right" : "analyze";
  const analyzeButton = $("#analyzeMobile");
  const overallQuality = step === "analyze" ? getOverallQuality() : null;
  updateEngineModeChip();
  $("#leftPreviewItem")?.classList.toggle("ready", leftReady);
  $("#rightPreviewItem")?.classList.toggle("ready", rightReady);
  renderQuality("left");
  renderQuality("right");
  updateText("#leftPreviewText", leftReady ? "?좏깮 ?꾨즺" : "?湲?);
  updateText("#rightPreviewText", rightReady ? "?좏깮 ?꾨즺" : "?湲?);
  if (analyzeButton) {
    analyzeButton.classList.remove("quality-good", "quality-warn", "quality-bad");
    if (overallQuality) analyzeButton.classList.add(`quality-${overallQuality.level}`);
    analyzeButton.disabled = step !== "analyze" || state.isAnalyzing;
    analyzeButton.setAttribute("aria-disabled", String(step !== "analyze" || state.isAnalyzing));
    analyzeButton.textContent =
      state.isAnalyzing
        ? "遺꾩꽍 吏꾪뻾 以?
        : step === "left"
        ? "?쇱넀 ?대?吏 ?꾩슂"
        : step === "right"
          ? "?ㅻⅨ???대?吏 ?꾩슂"
          : overallQuality?.level === "bad"
            ? state.lowQualityConfirmed
              ? "李멸퀬 遺꾩꽍 怨꾩냽"
              : "?ъ눋??沅뚯옣 ?뺤씤"
            : overallQuality?.level === "warn"
              ? "李멸퀬 遺꾩꽍 ?쒖옉"
              : "?묒넀 遺꾩꽍 ?쒖옉";
  }
  updateText(
    "#readyNote",
    !leftReady
      ? "?쇱넀遺??珥ъ쁺?섍굅??媛ㅻ윭由ъ뿉???좏깮??二쇱꽭??"
      : !rightReady
        ? "?쇱넀??以鍮꾨릺?덉뒿?덈떎. ?댁젣 ?ㅻⅨ?먯쓣 ?좏깮??二쇱꽭??"
        : overallQuality?.level === "bad"
          ? "?대?吏 ?덉쭏????뒿?덈떎. ?ㅼ떆 ?좏깮?섍굅??李멸퀬 遺꾩꽍?쇰줈 吏꾪뻾?????덉뒿?덈떎."
          : "?묒넀 ?대?吏媛 以鍮꾨릺?덉뒿?덈떎. 遺꾩꽍???쒖옉?????덉뒿?덈떎."
  );
  renderCaptureGuide(leftReady, rightReady);
  document.body.dataset.step = step;
}

function getEngineModeLabel() {
  if (ANALYSIS_ENGINE !== "api") return DEFAULT_ANALYSIS_ENGINE_LABEL;
  return CAN_USE_REMOTE_API ? "API 遺꾩꽍" : "API???쒕쾭 ?꾩슂";
}

function updateEngineModeChip() {
  const chip = $("#engineModeChip");
  if (!chip) return;
  chip.textContent = getEngineModeLabel();
  chip.classList.toggle("ready", ANALYSIS_ENGINE === "api");
}

function renderCaptureGuide(leftReady = Boolean(state.left), rightReady = Boolean(state.right)) {
  const guide = $("#captureGuide");
  if (!guide) return;

  const overall = leftReady && rightReady ? getOverallQuality() : null;
  let level = "warn";
  let title = "?쇱넀 珥ъ쁺 以鍮?;
  let text = "?먮컮???꾩껜媛 ?붾㈃ 以묒븰???ㅼ뼱?ㅺ퀬 ?먭툑??蹂댁씠?꾨줉 諛앹? 怨녹뿉??珥ъ쁺??二쇱꽭??";

  if (leftReady && !rightReady) {
    title = "?ㅻⅨ??珥ъ쁺 以鍮?;
    text = "?쇱넀怨?鍮꾩듂??嫄곕━? 諛앷린濡??ㅻⅨ???먮컮?μ쓣 ?뺣㈃?먯꽌 珥ъ쁺??二쇱꽭??";
  } else if (leftReady && rightReady && overall?.level === "bad") {
    level = "bad";
    title = state.lowQualityConfirmed ? "李멸퀬 遺꾩꽍 ?湲? : "?대?吏 ?ㅼ떆 ?좏깮 沅뚯옣";
    text = state.lowQualityConfirmed
      ? "?꾩옱 ?ъ쭊?쇰줈 李멸퀬 遺꾩꽍??吏꾪뻾?섎젮硫??꾨옒 踰꾪듉????踰????뚮윭 二쇱꽭??"
      : "?먮컮?μ씠 ?대몼嫄곕굹 ?먮━硫?遺꾩꽍 ?좊ː?꾧? ??븘吏묐땲?? 諛앹? 諛곌꼍?먯꽌 ?ㅼ떆 珥ъ쁺??二쇱꽭??";
  } else if (leftReady && rightReady && overall?.level === "warn") {
    title = "李멸퀬 遺꾩꽍 媛??;
    text = "遺꾩꽍? 媛?ν븯吏留??쇰? ?좊챸?꾧? 遺議깊빀?덈떎. ??諛앷쾶 珥ъ쁺?섎㈃ 寃곌낵媛 ?덉젙?곸엯?덈떎.";
  } else if (leftReady && rightReady) {
    level = "good";
    title = "遺꾩꽍 以鍮??꾨즺";
    text = "?묒넀 ?대?吏 ?덉쭏??異⑸텇?⑸땲?? ?꾨옒 踰꾪듉?쇰줈 遺꾩꽍???쒖옉??二쇱꽭??";
  }

  guide.classList.remove("good", "warn", "bad");
  guide.classList.add(level);
  updateText("#captureGuideTitle", title);
  updateText("#captureGuideText", text);
}

function renderQuality(hand) {
  const quality = state.quality[hand];
  const handCheck = state.handCheck[hand];
  const item = $(`#${hand}PreviewItem`);
  const text = $(`#${hand}QualityText`);
  if (!item || !text) return;

  item.classList.remove("quality-good", "quality-warn", "quality-bad");
  item.classList.toggle("hand-mismatch", Boolean(handCheck?.mismatch));
  if (!quality) {
    text.textContent = "?덉쭏 ?湲?;
    return;
  }

  item.classList.add(`quality-${quality.level}`);
  text.textContent = handCheck?.mismatch
    ? `${handCheck.message} 쨌 ${quality.label} ${quality.total}%`
    : handCheck?.needsReview
      ? `??諛⑺뼢 ?뺤씤 ?꾩슂 쨌 ${quality.label} ${quality.total}%`
      : `${quality.label} ${quality.total}%`;
}

function updateText(selector, text) {
  const element = $(selector);
  if (element) element.textContent = text;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function resizeImageForApi(dataUrl, maxSize = 1024, quality = 0.82) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function detectHandSide(dataUrl) {
  const image = await loadImage(dataUrl);
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const roi = getPalmRoiRect(image);
  ctx.drawImage(image, roi.x, roi.y, roi.width, roi.height, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  let leftBrightness = 0;
  let rightBrightness = 0;
  let leftEdges = 0;
  let rightEdges = 0;

  for (let y = 1; y < size; y += 1) {
    for (let x = 1; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const prevIndex = (y * size + x - 1) * 4;
      const value = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      const prev = data[prevIndex] * 0.299 + data[prevIndex + 1] * 0.587 + data[prevIndex + 2] * 0.114;
      const edge = Math.abs(value - prev);
      const isLeft = x < size / 2;
      if (isLeft) {
        leftBrightness += value;
        leftEdges += edge;
      } else {
        rightBrightness += value;
        rightEdges += edge;
      }
    }
  }

  const leftScore = leftBrightness * 0.003 + leftEdges;
  const rightScore = rightBrightness * 0.003 + rightEdges;
  const total = leftScore + rightScore;
  const confidence = total ? Math.abs(leftScore - rightScore) / total : 0;

  if (confidence < 0.025) {
    return { side: "unknown", confidence, level: "unknown" };
  }

  return {
    side: leftScore > rightScore ? "right" : "left",
    confidence,
    level: confidence > 0.055 ? "high" : "low",
  };
}

async function updateHandCheck(hand) {
  if (!state[hand]) return;
  const detected = await detectHandSide(state[hand]);
  const mismatch = false;
  state.handCheck[hand] = {
    ...detected,
    mismatch,
    needsReview: detected.side === "unknown" || detected.level !== "high",
    message: mismatch ? `${detected.side === "left" ? "?쇱넀" : "?ㅻⅨ??}泥섎읆 蹂댁엫` : "",
  };
}

function getPalmRoiRect(image) {
  const shortest = Math.min(image.naturalWidth, image.naturalHeight);
  const roiWidth = Math.round(shortest * 0.78);
  const roiHeight = Math.round(shortest * 0.9);
  const centerX = image.naturalWidth / 2;
  const centerY = image.naturalHeight * 0.53;

  return {
    x: Math.max(0, Math.round(centerX - roiWidth / 2)),
    y: Math.max(0, Math.round(centerY - roiHeight / 2)),
    width: Math.min(roiWidth, image.naturalWidth),
    height: Math.min(roiHeight, image.naturalHeight),
  };
}

async function analyzeImageMetrics(dataUrl) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const size = 192;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const roi = getPalmRoiRect(image);
  ctx.drawImage(image, roi.x, roi.y, roi.width, roi.height, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const gray = new Float32Array(size * size);
  let sum = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    gray[p] = value;
    sum += value;
  }

  const mean = sum / gray.length;
  let variance = 0;
  let edgeHits = 0;
  const zones = {
    life: { edge: 0, count: 0 },
    head: { edge: 0, count: 0 },
    heart: { edge: 0, count: 0 },
    fate: { edge: 0, count: 0 },
  };

  for (let y = 1; y < size; y += 1) {
    for (let x = 1; x < size; x += 1) {
      const index = y * size + x;
      const diff = gray[index] - mean;
      variance += diff * diff;
      const gx = Math.abs(gray[index] - gray[index - 1]);
      const gy = Math.abs(gray[index] - gray[index - size]);
      const edge = gx + gy;
      if (edge > 34) edgeHits += 1;

      const nx = x / size;
      const ny = y / size;
      if (nx < 0.58 && ny > 0.45) {
        zones.life.edge += edge;
        zones.life.count += 1;
      }
      if (ny > 0.43 && ny < 0.66) {
        zones.head.edge += edge;
        zones.head.count += 1;
      }
      if (ny > 0.25 && ny < 0.48) {
        zones.heart.edge += edge;
        zones.heart.count += 1;
      }
      if (nx > 0.38 && nx < 0.66 && ny > 0.34) {
        zones.fate.edge += edge;
        zones.fate.count += 1;
      }
    }
  }

  const contrast = Math.sqrt(variance / gray.length);
  const edgeDensity = edgeHits / gray.length;
  return {
    mean,
    contrast,
    edgeDensity,
    zones: Object.fromEntries(
      Object.entries(zones).map(([key, zone]) => [key, zone.count ? zone.edge / zone.count : 0])
    ),
  };
}

function scoreMetrics(metrics) {
  const brightness = clampScore(100 - Math.abs(metrics.mean - 145) * 0.8);
  const contrast = clampScore(metrics.contrast * 2.15);
  const edges = clampScore(metrics.edgeDensity * 320);
  const zones = {
    life: clampScore(metrics.zones.life * 3.2),
    head: clampScore(metrics.zones.head * 3.2),
    heart: clampScore(metrics.zones.heart * 3.2),
    fate: clampScore(metrics.zones.fate * 3.2),
  };
  return { brightness, contrast, edges, zones };
}

function classifyQuality(metrics) {
  const score = scoreMetrics(metrics);
  const total = clampScore(score.brightness * 0.28 + score.contrast * 0.32 + score.edges * 0.4);
  const level = total >= 58 ? "good" : total >= 38 ? "warn" : "bad";
  const label = level === "good" ? "?덉쭏 ?묓샇" : level === "warn" ? "李멸퀬 遺꾩꽍" : "?ъ눋??沅뚯옣";
  return { ...score, total, level, label };
}

async function updateHandQuality(hand) {
  if (!state[hand]) return;
  const metrics = await analyzeImageMetrics(state[hand]);
  state.quality[hand] = classifyQuality(metrics);
}

function getOverallQuality() {
  const qualities = [state.quality.left, state.quality.right].filter(Boolean);
  if (qualities.length < 2) return { level: "warn", label: "?덉쭏 ?뺤씤 以? };
  if (qualities.some((item) => item.level === "bad")) return { level: "bad", label: "?ъ눋??沅뚯옣" };
  if (qualities.some((item) => item.level === "warn")) return { level: "warn", label: "李멸퀬 遺꾩꽍" };
  return { level: "good", label: "?덉쭏 ?묓샇" };
}

function scoreBand(value) {
  if (value >= 72) return "high";
  if (value >= 45) return "mid";
  return "low";
}

function lineBasis(value, areaLabel) {
  const band = scoreBand(value);
  if (band === "high") return `${areaLabel} ?꾨낫??媛뺥븿`;
  if (band === "mid") return `${areaLabel} ?꾨낫??蹂댄넻`;
  return `${areaLabel} ?꾨낫???쏀븿`;
}

function getAnalysisAdvice(scores, quality) {
  if (quality.level === "bad" || scores.confidence < 38) {
    return {
      level: "bad",
      title: "?ъ눋??沅뚯옣",
      text: "?먮컮???꾩껜媛 諛앷쾶 蹂댁씠?꾨줉 ?ㅼ떆 珥ъ쁺?섎㈃ ???덉젙?곸씤 ?댁꽍??媛?ν빀?덈떎.",
    };
  }

  if (quality.level === "warn" || scores.confidence < 58) {
    return {
      level: "warn",
      title: "李멸퀬 遺꾩꽍",
      text: "?쇰? ?좊챸?꾧? 遺議깊빐 寃곌낵??李멸퀬?⑹엯?덈떎. ?먮컮?μ쓣 ?붾㈃ 以묒븰???먮㈃ ?먯닔媛 媛쒖꽑?⑸땲??",
    };
  }

  return {
    level: "good",
    title: "遺꾩꽍 議곌굔 ?묓샇",
    text: "諛앷린? ?먭툑 ?꾨낫?좎씠 異⑸텇??媛먯??섏뼱 ?꾩옱 ?ъ쭊 湲곗??쇰줈 ?댁꽍?덉뒿?덈떎.",
  };
}

function buildInterpretation(scores, quality) {
  const life = scoreBand(scores.life);
  const head = scoreBand(scores.head);
  const heart = scoreBand(scores.heart);
  const fate = scoreBand(scores.fate);
  const qualityPrefix = quality.level === "bad" ? "?대?吏 ?덉쭏????븘 李멸퀬?⑹쑝濡?蹂대㈃, " : "";

  return {
    left:
      life === "high"
        ? `${qualityPrefix}?怨좊궃 ?먮꼫吏? ?앺솢 由щ벉??媛뺥븯寃??곕뒗 ?먮쫫?낅땲??`
        : life === "mid"
          ? `${qualityPrefix}湲곕낯 由щ벉? ?덉젙?곸씠吏留?而⑤뵒??蹂?붿뿉 ?곕씪 ?먮쫫???щ씪吏????덉뒿?덈떎.`
          : `${qualityPrefix}?앺솢 由щ벉蹂대떎 ?뚮났怨??뺣룉????以묒슂????낆쑝濡??댁꽍?⑸땲??`,
    right:
      fate === "high"
        ? "?꾩옱??紐⑺몴瑜??ν빐 諛怨?媛???ㅽ뻾 ?⑦꽩??鍮꾧탳???쒕졆?⑸땲??"
        : fate === "mid"
          ? "?꾩옱 ?⑦꽩? ?좎뿰?섍쾶 議곗젙?섎ŉ 諛⑺뼢???≪븘媛??履쎌뿉 媛源앹뒿?덈떎."
          : "?꾩옱????諛⑺뼢?쇰줈 紐곗븘媛湲곕낫???좏깮吏瑜??볤쾶 蹂대뒗 ?먮쫫?낅땲??",
    personality:
      head === "high"
        ? "遺꾩꽍怨?援ъ“?붾? ?좏샇?섎뒗 怨꾪쉷???깊뼢???먮뱶?ъ쭛?덈떎."
        : head === "mid"
          ? "吏곴?怨??꾩떎 ?먮떒???④퍡 ?곕뒗 洹좏삎???깊뼢?낅땲??"
          : "利됲씎??媛먭컖怨??곹솴 ?곸쓳?μ씠 ???욎꽌???깊뼢?쇰줈 蹂댁엯?덈떎.",
    emotion:
      heart === "high"
        ? "媛먯젙???먮쫫???쒕졆??愿怨꾩뿉???쒗쁽?κ낵 怨듦컧 ?좏샇媛 媛뺥븯寃??쏀옓?덈떎."
        : heart === "mid"
          ? "媛먯젙 ?쒗쁽? ?덉젙?곸씠吏留? 以묒슂??愿怨꾩뿉?쒕뒗 ?띾룄瑜?議곗젅?섎뒗 ?몄엯?덈떎."
          : "媛먯젙??諛붾줈 ?쒕윭?닿린蹂대떎 愿李???諛섏쓳?섎뒗 ?좎쨷???⑦꽩?낅땲??",
    thinking:
      head === "high"
        ? "臾몄젣瑜?鍮좊Ⅴ寃?遺꾪빐?섍퀬 洹쇨굅瑜?李얠븘 ?먮떒?섎뒗 諛⑹떇??媛뺤젏???덉뒿?덈떎."
        : head === "mid"
          ? "??諛⑺뼢??癒쇱? ?↔퀬 ?꾩슂??留뚰겮 ?몃?瑜??먭??섎뒗 ?ш퀬 ?먮쫫?낅땲??"
          : "?뺣떟??怨좎젙?섍린蹂대떎 遺꾩쐞湲곗? 留λ씫???쎌쑝硫??吏곸씠??履쎌엯?덈떎.",
    relation:
      heart === "high" && life !== "low"
        ? "媛源뚯슫 愿怨꾩뿉 源딄쾶 紐곗엯?섍퀬 袁몄????좎??섎젮???섏씠 ?덉뒿?덈떎."
        : heart === "low"
          ? "愿怨꾩뿉?쒕뒗 ?띾룄蹂대떎 ?좊ː 異뺤쟻???곗꽑?섎뒗 嫄곕━ 議곗젅?뺤엯?덈떎."
          : "愿怨꾩쓽 洹좏삎??蹂대ŉ ?꾩슂??留뚰겮 ?쒗쁽?섎뒗 ?덉젙???⑦꽩?낅땲??",
  };
}

function buildDetailedReport(scores, quality, interpretation, advice) {
  const confidenceText =
    scores.confidence >= 72
      ? "?ъ쭊 議곌굔怨??먭툑 ?꾨낫?좎씠 鍮꾧탳???먮졆???댁꽍 ?먮쫫???덉젙?곸쑝濡??≫삍?듬땲??"
      : scores.confidence >= 45
        ? "?ъ쭊?먯꽌 ?먭툑 ?꾨낫?좎? 媛먯??섏?留??쇰? ?곸뿭? 李멸퀬 ?섏??쇰줈 蹂대뒗 寃껋씠 醫뗭뒿?덈떎."
        : "?ъ쭊 ?덉쭏????븘 寃곌낵??媛踰쇱슫 李멸퀬?⑹쑝濡쒕쭔 蹂대뒗 寃껋씠 醫뗭뒿?덈떎.";
  const dominantLine = [
    ["Life Line", scores.life],
    ["Head Line", scores.head],
    ["Heart Line", scores.heart],
    ["Fate Line", scores.fate],
  ].sort((a, b) => b[1] - a[1])[0];

  return {
    summary: `${confidenceText} 媛??媛뺥븯寃??≫엺 ?먮쫫? ${dominantLine[0]}?대ŉ, ?꾩껜 由ы룷?몃뒗 ?뷀꽣?뚯씤癒쇳듃???먭린?깆같 ?뚰듃?낅땲??`,
    current: `${interpretation.right} ${advice.level === "bad" ? "?ㅻ쭔 ?ъ눋?????ㅼ떆 ?뺤씤?섎㈃ ???덉젙?곸씤 ?먮쫫??蹂????덉뒿?덈떎." : "吏湲덉? 諛⑺뼢???볤쾶 蹂대릺 ?ㅽ뻾 ?쒖꽌瑜??뺣━?섎뒗 履쎌씠 ?댁슱由쎈땲??"}`,
    emotion: `${interpretation.emotion} ${interpretation.relation}`,
    advice: `${advice.text} ?먯닔??醫뗪퀬 ?섏겏???먯젙???꾨땲???ъ쭊?먯꽌 媛먯????좊챸?꾩? ?꾨낫?좎쓽 媛뺣룄瑜?諛뷀깢?쇰줈 ??李멸퀬 吏?쒖엯?덈떎.`,
  };
}

function buildPerspicaciousReport(scores, interpretation) {
  const heartHigh = scores.heart >= 65;
  const headHigh = scores.head >= 65;
  const lifeHigh = scores.life >= 65;
  const fateHigh = scores.fate >= 65;

  return {
    ideal:
      heartHigh && headHigh
        ? "?댁긽?뺤? 媛먯젙?곸쑝濡??곕쑜?섎㈃?쒕룄 ??붿쓽 寃곗씠 ??留욌뒗 ?щ엺?먭쾶 ?뚮━???몄엯?덈떎. ?⑥닚???멸컧蹂대떎 ?좊ː, 留먯쓽 ?⑤룄, ?앷컖??洹좏삎??以묒슂?섍쾶 蹂대뒗 ?먮쫫?낅땲??"
        : heartHigh
          ? "?뺤꽌?곸쑝濡??덉젙媛먯쓣 二쇨퀬 ?좎젙 ?쒗쁽???먯뿰?ㅻ윭???щ엺?먭쾶 ?뚮┫ 媛?μ꽦???쎈땲?? 愿怨꾩뿉???ㅼ젙?④낵 吏꾩떖???ㅻ옒 ?⑤뒗 ??낆엯?덈떎."
          : "泥섏쓬遺??媛뺥븯寃?紐곗엯?섍린蹂대떎 ?몄븞?섍쾶 嫄곕━瑜?醫곹?媛???щ엺?먭쾶 ?멸컧???먮겮???먮쫫?낅땲?? 遺???녿뒗 ?덉젙媛먯씠 ?댁긽?뺤쓽 以묒슂??議곌굔?낅땲??",
    romance:
      fateHigh
        ? "?곗븷?먯꽌??諛⑺뼢???뺥빐吏硫?苑?梨낆엫媛??덇쾶 愿怨꾨? ?대걣?닿??ㅻ뒗 ?몄엯?덈떎. ?ㅻ쭔 ?ㅼ뒪濡??뺤떊???앷린湲??꾧퉴吏??愿李??쒓컙???꾩슂?⑸땲??"
        : "?곗븷??鍮좊Ⅸ 寃곗젙蹂대떎 遺꾩쐞湲곗? ?곹샇 諛섏쓳??蹂대ŉ 泥쒖쿇??源딆뼱吏??履쎌뿉 媛源앹뒿?덈떎. ?곷????쒕룄 蹂?붿뿉 誘쇨컧?섍쾶 諛섏쓳?섎뒗 硫대룄 ?덉뒿?덈떎.",
    affection:
      lifeHigh
        ? "?좎젙 ?쒗쁽? ?앺솢 ?띿뿉??梨숆꺼二쇨퀬 ?④퍡 ?쒓컙???볥뒗 諛⑹떇?쇰줈 ?쒕윭?섍린 ?쎌뒿?덈떎. 留먮낫???됰룞?쇰줈 ?덉젙媛먯쓣 二쇰뒗 ??낆뿉 媛源앹뒿?덈떎."
        : "?좎젙? 源딆?留??쒗쁽 ?띾룄???좎쨷?????덉뒿?덈떎. 留덉쓬???대━湲??꾩뿉??議곗떖?ㅻ읇吏留? ?좊ː媛 ?앷린硫?袁몄???愿怨꾨? ?좎??섎젮???먮쫫?낅땲??",
    intimacy:
      headHigh
        ? "移쒕?媛먯뿉?쒕뒗 媛먯젙???띾룄蹂대떎 ?좊ː? ?щ━???덉젙媛먯쓣 癒쇱? ?뺤씤?섎젮??寃쏀뼢???덉뒿?덈떎. 媛源뚯썙吏덉닔濡???붿? 諛곕젮媛 以묒슂??湲곗????⑸땲??"
        : "移쒕?媛먯? 遺꾩쐞湲곗? 媛먯젙 援먮쪟???곹뼢??留롮씠 諛쏅뒗 ?먮쫫?낅땲?? 利됲씎?곸씤 ?뚮┝蹂대떎 ?쒕줈 ?몄븞?섎떎怨??먮겮???쒓컙???먯뿰?ㅻ읇寃?源딆뼱吏????낆엯?덈떎.",
  };
}

async function calculatePalmScores() {
  const [leftMetrics, rightMetrics] = await Promise.all([
    analyzeImageMetrics(state.left),
    analyzeImageMetrics(state.right),
  ]);
  const left = scoreMetrics(leftMetrics);
  const right = scoreMetrics(rightMetrics);
  const avg = {
    brightness: (left.brightness + right.brightness) / 2,
    contrast: (left.contrast + right.contrast) / 2,
    edges: (left.edges + right.edges) / 2,
    zones: {
      life: (left.zones.life + right.zones.life) / 2,
      head: (left.zones.head + right.zones.head) / 2,
      heart: (left.zones.heart + right.zones.heart) / 2,
      fate: (left.zones.fate + right.zones.fate) / 2,
    },
  };

  const confidence = clampScore(avg.brightness * 0.26 + avg.contrast * 0.34 + avg.edges * 0.4);
  return {
    confidence,
    life: clampScore(avg.zones.life * 0.54 + avg.contrast * 0.24 + right.brightness * 0.22),
    head: clampScore(avg.zones.head * 0.56 + avg.contrast * 0.26 + left.brightness * 0.18),
    heart: clampScore(avg.zones.heart * 0.56 + left.contrast * 0.24 + avg.brightness * 0.2),
    fate: clampScore(avg.zones.fate * 0.58 + avg.contrast * 0.24 + Math.min(left.brightness, right.brightness) * 0.18),
  };
}

function createAnalysisResult(scores, quality, engineLabel = DEFAULT_ANALYSIS_ENGINE_LABEL) {
  const insights = buildInterpretation(scores, quality);
  const advice = getAnalysisAdvice(scores, quality);
  return {
    engineLabel,
    scores,
    insights,
    advice,
    report: buildDetailedReport(scores, quality, insights, advice),
  };
}

function normalizeAnalysisResult(result, fallbackQuality) {
  const scores = {
    confidence: clampScore(result?.scores?.confidence ?? result?.confidence ?? 0),
    life: clampScore(result?.scores?.life ?? result?.life ?? 0),
    head: clampScore(result?.scores?.head ?? result?.head ?? 0),
    heart: clampScore(result?.scores?.heart ?? result?.heart ?? 0),
    fate: clampScore(result?.scores?.fate ?? result?.fate ?? 0),
  };
  const fallback = createAnalysisResult(scores, fallbackQuality, result?.engineLabel || "AI 遺꾩꽍");

  return {
    engineLabel: result?.engineLabel || fallback.engineLabel,
    scores,
    insights: { ...fallback.insights, ...(result?.insights || {}) },
    advice: { ...fallback.advice, ...(result?.advice || {}) },
    report: { ...fallback.report, ...(result?.report || {}) },
  };
}

async function runApiPalmAnalysis() {
  const [leftImage, rightImage] = await Promise.all([
    resizeImageForApi(state.left),
    resizeImageForApi(state.right),
  ]);

  const response = await fetch(API_ANALYSIS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leftImage,
      rightImage,
      quality: {
        left: state.quality.left,
        right: state.quality.right,
        overall: getOverallQuality(),
      },
    }),
  });

  if (!response.ok) throw new Error("AI analysis request failed");
  return normalizeAnalysisResult(await response.json(), getOverallQuality());
}

async function runPalmAnalysis() {
  if (ANALYSIS_ENGINE === "api") {
    try {
      if (!["http:", "https:"].includes(window.location.protocol)) {
        throw new Error("API mode requires an http or https origin");
      }
      return await runApiPalmAnalysis();
    } catch (error) {
      console.warn("AI analysis failed. Falling back to browser analysis.", error);
    }
  }

  const scores = await calculatePalmScores();
  return {
    ...createAnalysisResult(
      scores,
      getOverallQuality(),
      ANALYSIS_ENGINE === "api" ? FALLBACK_ANALYSIS_ENGINE_LABEL : DEFAULT_ANALYSIS_ENGINE_LABEL
    ),
  };
}

function analyze() {
  if (state.isAnalyzing) return;

  if (!state.left || !state.right) {
    const nextStep = !state.left ? "?쇱넀" : "?ㅻⅨ??;
    updateText("#mobileProgress", `${nextStep} ?꾩슂`);
    document.body.dataset.step = !state.left ? "left" : "right";
    return;
  }

  const overallQuality = getOverallQuality();
  if (overallQuality.level === "bad" && !state.lowQualityConfirmed) {
    state.lowQualityConfirmed = true;
    renderStatuses();
    updateText("#readyNote", "?ъ눋?곸쓣 沅뚯옣?⑸땲?? 洹몃옒??吏꾪뻾?섎젮硫?遺꾩꽍 踰꾪듉????踰????뚮윭 二쇱꽭??");
    return;
  }

  state.isAnalyzing = true;
  document.body.classList.add("analyzing");
  renderStatuses();
  setFlow("scanning");
  setScanProgress(18, "?먮컮???곸뿭 異붿텧 以?, 2);
  setPipeline(2);
  updateText("#mobileProgress", "42%");

  setTimeout(() => {
    setPipeline(3);
    updateText("#mobileProgress", "78%");
    setScanProgress(58, "?먭툑 ?꾨낫???먯깋 以?, 3);
  }, 650);

  setTimeout(async () => {
    try {
      setScanProgress(82, "?대?吏 ?뱀쭠 怨꾩궛 以?, 3);
      const result = await runPalmAnalysis();
      state.analysisResult = result;
      state.scores = result.scores;
      state.analysisEngineLabel = result.engineLabel;
      renderResults();
      setPipeline(4);
      updateText("#mobileProgress", `${state.scores.confidence}%`);
      setScanProgress(100, "?댁꽍 由ы룷???앹꽦 ?꾨즺", 4);
      setTimeout(() => setFlow("result"), 520);
    } finally {
      document.body.classList.remove("analyzing");
      state.isAnalyzing = false;
      renderStatuses();
    }
  }, 1450);
}

function renderResults() {
  const scores = state.scores;
  if (!scores) return;
  const quality = getOverallQuality();
  const analysis = state.analysisResult || createAnalysisResult(scores, quality, state.analysisEngineLabel);
  const interpretation = analysis.insights;
  const advice = analysis.advice;
  const report = analysis.report || buildDetailedReport(scores, quality, interpretation, advice);
  const deepReport = buildPerspicaciousReport(scores, interpretation);

  updateText("#mobileResultScore", `${scores.confidence}%`);
  updateText("#mobileLifeScore", `${scores.life}%`);
  updateText("#mobileHeartScore", `${scores.heart}%`);
  updateText("#mobileHeadScore", `${scores.head}%`);
  updateText("#mobileFateScore", `${scores.fate}%`);
  updateText("#analysisEngineText", analysis.engineLabel || DEFAULT_ANALYSIS_ENGINE_LABEL);
  updateText("#lifeBasis", lineBasis(scores.life, "醫뚰븯??));
  updateText("#headBasis", lineBasis(scores.head, "以묒븰 媛濡?));
  updateText("#heartBasis", lineBasis(scores.heart, "?곷떒 媛濡?));
  updateText("#fateBasis", lineBasis(scores.fate, "以묒븰 ?몃줈"));
  updateText("#resultQualityText", quality.label);
  const summary = $(".quality-summary");
  summary?.classList.remove("good", "warn", "bad");
  summary?.classList.add(quality.level);
  const resultScreen = $(".result-screen");
  resultScreen?.classList.remove("quality-good", "quality-warn", "quality-bad");
  resultScreen?.classList.add(`quality-${quality.level}`);
  const restartButton = $("#restartCaptureButton");
  if (restartButton) {
    restartButton.textContent = quality.level === "bad" ? "?ㅼ떆 珥ъ쁺?섍린" : "?대?吏 蹂寃?;
  }
  const adviceBox = $("#analysisAdvice");
  adviceBox?.classList.remove("good", "warn", "bad");
  adviceBox?.classList.add(advice.level);
  updateText("#analysisAdviceTitle", advice.title);
  updateText("#analysisAdviceText", advice.text);
  updateText("#leftInsight", interpretation.left);
  updateText("#rightInsight", interpretation.right);
  updateText("#personalityInsight", interpretation.personality);
  updateText("#emotionInsight", interpretation.emotion);
  updateText("#thinkingInsight", interpretation.thinking);
  updateText("#relationInsight", interpretation.relation);
  updateText("#summaryReport", report.summary);
  updateText("#currentReport", report.current);
  updateText("#emotionReport", report.emotion);
  updateText("#adviceReport", report.advice);
  updateText("#deepResultScore", `${scores.confidence}%`);
  updateText("#idealTypeInsight", deepReport.ideal);
  updateText("#romanceInsight", deepReport.romance);
  updateText("#affectionInsight", deepReport.affection);
  updateText("#intimacyInsight", deepReport.intimacy);
}

function returnToCapture() {
  const leftQuality = state.quality.left;
  const rightQuality = state.quality.right;
  const shouldFocusRight =
    rightQuality?.level === "bad" && leftQuality?.level !== "bad";

  state.lowQualityConfirmed = false;
  setFlow("capture");
  renderStatuses();
  setTimeout(() => {
    $(shouldFocusRight ? "#rightCaptureButton" : "#leftCaptureButton")?.focus();
  }, 0);
}

function openPerspicaciousAnalysis() {
  if (!state.scores) return;
  state.deepClickCount += 1;
  if (state.deepClickCount < 5) {
    return;
  }

  state.deepClickCount = 0;
  setFlow("deep");
}

function returnFromPerspicaciousAnalysis() {
  state.deepClickCount = 0;
  setFlow("result");
}

function setPipeline(activeIndex) {
  $$(".pipeline li").forEach((item, index) => {
    item.classList.toggle("done", index < activeIndex - 1);
    item.classList.toggle("active", index === activeIndex - 1);
  });
}

function setFlow(flow) {
  state.flow = flow;
  document.body.dataset.flow = flow;
}

function setScanProgress(percent, phase, activeIndex) {
  updateText("#scanProgressText", `${percent}%`);
  updateText("#scanPhase", phase);
  const bar = $("#scanProgressBar");
  if (bar) bar.style.width = `${percent}%`;
  $$(".mobile-scan-steps li").forEach((item, index) => {
    item.classList.toggle("done", index < activeIndex - 1);
    item.classList.toggle("active", index === activeIndex - 1);
  });
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = text.split(" ");
  let line = "";
  let lines = [];

  words.forEach((word) => {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  });
  if (line) lines.push(line);
  lines = lines.slice(0, maxLines);

  lines.forEach((item, index) => {
    ctx.fillText(item, x, y + index * lineHeight);
  });
}

function setShareBusy(isBusy) {
  state.isSharing = isBusy;
  const buttons = [$("#shareCardButton"), $("#deepShareButton")].filter(Boolean);
  buttons.forEach((button) => {
    button.disabled = isBusy;
    button.textContent = isBusy ? "이미지 생성 중" : "결과 이미지 공유";
  });
}

async function shareOrDownloadCard(blob, scores) {
  openSharePreview(blob);
  updateText("#mobileResultScore", "이미지 준비");
}

function openSharePreview(blob) {
  if (state.shareUrl) URL.revokeObjectURL(state.shareUrl);
  state.shareBlob = blob;
  state.shareUrl = URL.createObjectURL(blob);
  const previewImage = $("#sharePreviewImage");
  const downloadLink = $("#downloadShareImageLink");
  if (previewImage) previewImage.src = state.shareUrl;
  if (downloadLink) downloadLink.href = state.shareUrl;
  $("#shareSheet")?.classList.add("open");
  $("#shareSheet")?.setAttribute("aria-hidden", "false");
  document.body.classList.add("share-open");
}

function closeSharePreview() {
  $("#shareSheet")?.classList.remove("open");
  $("#shareSheet")?.classList.remove("expanded");
  $("#shareSheet")?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("share-open");
}

async function nativeSharePreparedImage() {
  if (!state.shareBlob) return;
  const file = new File([state.shareBlob], "cyberpalm-result.png", { type: "image/png" });
  const canUseNativeShare =
    window.isSecureContext &&
    ["http:", "https:"].includes(window.location.protocol) &&
    navigator.share &&
    navigator.canShare?.({ files: [file] });

  if (canUseNativeShare) {
    await navigator.share({
      files: [file],
      title: "Palmistry AI 결과",
      text: "Palmistry AI 분석 결과 이미지입니다.",
    });
    updateText("#mobileResultScore", "공유완료");
    return;
  }

  $("#sharePreviewImage")?.scrollIntoView({ block: "center" });
}

function expandSharePreview() {
  $("#shareSheet")?.classList.toggle("expanded");
}
function canvasToPngBlob(canvas) {
  return Promise.resolve(dataUrlToBlob(canvas.toDataURL("image/png")));
}

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mimeType = meta.match(/data:(.*?);/)?.[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function createShareCard(mode = "summary") {
  if (!state.scores) {
    updateText("#mobileResultScore", "遺꾩꽍?꾩슂");
    return;
  }
  if (state.isSharing) return;
  setShareBusy(true);

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = mode === "deep" ? 2240 : 3120;
  const ctx = canvas.getContext("2d");
  const scores = state.scores;
  const quality = getOverallQuality();
  const analysis = state.analysisResult || createAnalysisResult(scores, quality, state.analysisEngineLabel);
  const interpretation = analysis.insights;
  const advice = analysis.advice;
  const report = analysis.report || buildDetailedReport(scores, quality, interpretation, advice);
  const deepReport = buildPerspicaciousReport(scores, interpretation);

  const bg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  bg.addColorStop(0, "#050816");
  bg.addColorStop(0.48, "#07152b");
  bg.addColorStop(1, "#050714");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(32, 240, 255, 0.12)";
  ctx.lineWidth = 2;
  for (let x = 0; x < canvas.width; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 72) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  const glow = ctx.createRadialGradient(540, 650, 80, 540, 650, 620);
  glow.addColorStop(0, "rgba(32, 240, 255, 0.32)");
  glow.addColorStop(0.55, "rgba(255, 77, 255, 0.12)");
  glow.addColorStop(1, "rgba(32, 240, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.fillStyle = "#f3feff";
  ctx.font = "900 78px Arial, sans-serif";
  ctx.shadowColor = "rgba(32, 240, 255, 0.9)";
  ctx.shadowBlur = 26;
  ctx.fillText("CYBERPALM", 540, 170);
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#20f0ff";
  ctx.font = "700 28px Arial, sans-serif";
  ctx.fillText(mode === "deep" ? "PERSPICACIOUS ANALYSIS" : "AI PALM SCAN REPORT", 540, 224);

  ctx.strokeStyle = "rgba(32, 240, 255, 0.55)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(540, 575, 300, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 77, 255, 0.72)";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(350, 735);
  ctx.bezierCurveTo(300, 560, 390, 410, 530, 350);
  ctx.stroke();
  ctx.strokeStyle = "rgba(32, 240, 255, 0.84)";
  ctx.beginPath();
  ctx.moveTo(295, 610);
  ctx.bezierCurveTo(450, 540, 650, 540, 805, 625);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(355, 470);
  ctx.bezierCurveTo(505, 540, 670, 515, 792, 420);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(560, 820);
  ctx.bezierCurveTo(515, 660, 550, 500, 630, 355);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 58px Arial, sans-serif";
  ctx.fillText(`遺꾩꽍 ?좊ː??${scores.confidence}%`, 540, 980);

  ctx.fillStyle = quality.level === "bad" ? "#ff7a8a" : quality.level === "warn" ? "#ffd166" : "#49ffb3";
  ctx.font = "900 30px Arial, sans-serif";
  ctx.fillText(`?대?吏 ?덉쭏: ${quality.label}`, 540, 1035);

  const scoreItems = [
    ["Life Line", `${scores.life}%`],
    ["Head Line", `${scores.head}%`],
    ["Heart Line", `${scores.heart}%`],
    ["Fate Line", `${scores.fate}%`],
  ];
  scoreItems.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 110 + col * 455;
    const y = 1115 + row * 160;
    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    ctx.strokeStyle = "rgba(126, 245, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, 405, 120, 22);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#93a8ba";
    ctx.font = "700 26px Arial, sans-serif";
    ctx.fillText(label, x + 28, y + 44);
    ctx.fillStyle = "#49ffb3";
    ctx.font = "900 44px Arial, sans-serif";
    ctx.fillText(value, x + 28, y + 92);
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  ctx.strokeStyle = "rgba(126, 245, 255, 0.22)";
  ctx.beginPath();
  ctx.roundRect(110, 1450, 860, 290, 24);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#20f0ff";
  ctx.font = "900 30px Arial, sans-serif";
  ctx.fillText(advice.title, 150, 1510);
  ctx.fillStyle = "#f4fbff";
  ctx.font = "700 30px Arial, sans-serif";
  drawWrappedText(ctx, report.summary, 150, 1570, 780, 44, 2);
  ctx.fillStyle = "#ffc9d0";
  ctx.font = "600 24px Arial, sans-serif";
  drawWrappedText(ctx, report.advice, 150, 1660, 780, 34, 2);

  const summaryItems = [
    ["?쇱넀", interpretation.left],
    ["?ㅻⅨ??, interpretation.right],
    ["?깊뼢", interpretation.personality],
    ["媛먯젙", interpretation.emotion],
    ["?ш퀬", interpretation.thinking],
    ["愿怨?, interpretation.relation],
    ["?듭떖 ?붿빟", report.summary],
    ["?꾩옱 ?먮쫫", report.current],
    ["媛먯젙怨?愿怨?, report.emotion],
    ["?ㅻ뒛??議곗뼵", report.advice],
  ];
  const deepItems = [
    ["?댁긽???깊뼢", deepReport.ideal],
    ["?곗븷 ?깊뼢", deepReport.romance],
    ["?좎젙 ?깊뼢", deepReport.affection],
    ["?깆쟻 ?깊뼢", deepReport.intimacy],
  ];
  const reportItems = mode === "deep" ? deepItems : summaryItems;

  let reportY = 1818;
  reportItems.forEach(([title, text]) => {
    ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
    ctx.strokeStyle = "rgba(126, 245, 255, 0.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(110, reportY, 860, 124, 18);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#20f0ff";
    ctx.font = "900 24px Arial, sans-serif";
    ctx.fillText(title, 145, reportY + 38);
    ctx.fillStyle = "#f4fbff";
    ctx.font = "600 23px Arial, sans-serif";
    drawWrappedText(ctx, text, 145, reportY + 76, 790, 31, 2);
    reportY += 138;
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "#93a8ba";
  ctx.font = "700 24px Arial, sans-serif";
  ctx.fillText("?뷀꽣?뚯씤癒쇳듃 諛??먭린?깆같 紐⑹쟻??李멸퀬 由ы룷??, 540, reportY + 38);

  canvasToPngBlob(canvas)
    .then((blob) => shareOrDownloadCard(blob, scores))
    .catch(() => updateText("#mobileResultScore", "怨듭쑀痍⑥냼"))
    .finally(() => {
      setShareBusy(false);
      setTimeout(() => updateText("#mobileResultScore", `${scores.confidence}%`), 1200);
    });
}

function resetApp() {
  state.left = null;
  state.right = null;
  state.scores = null;
  state.analysisEngineLabel = DEFAULT_ANALYSIS_ENGINE_LABEL;
  state.analysisResult = null;
  state.quality.left = null;
  state.quality.right = null;
  state.handCheck.left = null;
  state.handCheck.right = null;
  state.lowQualityConfirmed = false;
  state.isAnalyzing = false;
  state.isSharing = false;
  state.shareBlob = null;
  if (state.shareUrl) URL.revokeObjectURL(state.shareUrl);
  state.shareUrl = null;
  state.deepClickCount = 0;
  ["#mobilePreview"].forEach((selector) => {
    const image = $(selector);
    if (image) image.removeAttribute("src");
  });
  ["#leftMobileThumb", "#rightMobileThumb"].forEach((selector) => {
    const image = $(selector);
    if (image) image.removeAttribute("src");
  });
  updateText("#mobileProgress", "0%");
  updateText("#mobileResultScore", "--");
  updateText("#mobileLifeScore", "--");
  updateText("#mobileHeartScore", "--");
  updateText("#mobileHeadScore", "--");
  updateText("#mobileFateScore", "--");
  updateText("#lifeBasis", "--");
  updateText("#headBasis", "--");
  updateText("#heartBasis", "--");
  updateText("#fateBasis", "--");
  updateText("#resultQualityText", "--");
  updateText("#analysisEngineText", DEFAULT_ANALYSIS_ENGINE_LABEL);
  updateText("#summaryReport", "?묒넀??二쇱슂 ?먮쫫??諛뷀깢?쇰줈 ?꾩옱 ?깊뼢怨?由щ벉???붿빟?⑸땲??");
  updateText("#currentReport", "理쒓렐???좏깮怨??ㅽ뻾 ?먮쫫??李멸퀬?⑹쑝濡??댁꽍?⑸땲??");
  updateText("#emotionReport", "媛먯젙 ?쒗쁽怨?愿怨??⑦꽩???④퍡 ?댄렣遊낅땲??");
  updateText("#adviceReport", "寃곌낵瑜??먭린?깆같???뚰듃濡?媛蹂띻쾶 ?쒖슜??二쇱꽭??");
  updateText("#deepResultScore", "--");
  updateText("#idealTypeInsight", "?곷??먭쾶 湲곕??섎뒗 ?뺤꽌???덉젙媛먭낵 ?뚮┝??諛⑺뼢???댁꽍?⑸땲??");
  updateText("#romanceInsight", "愿怨꾧? ?쒖옉?섍퀬 源딆뼱吏??뚯쓽 ?띾룄? ?쒗쁽 諛⑹떇???댄렣遊낅땲??");
  updateText("#affectionInsight", "?좎젙??二쇨퀬諛쏅뒗 諛⑹떇怨?移쒕?媛먯쓽 由щ벉??李멸퀬?⑹쑝濡??댁꽍?⑸땲??");
  updateText("#intimacyInsight", "?깆쟻???쒗쁽???꾨땲??移쒕?媛? ?좊ː, 嫄곕━媛먯쓽 ?먮쫫??以묒떖?쇰줈 ?댁꽍?⑸땲??");
  updateText("#analysisAdviceTitle", "遺꾩꽍 湲곗? ?뺤씤 以?);
  updateText("#analysisAdviceText", "?묒넀 ?ъ쭊??諛앷린, ?좊챸?? ?먭툑 ?꾨낫?좎쓣 ?④퍡 ?뺤씤?⑸땲??");
  $(".quality-summary")?.classList.remove("good", "warn", "bad");
  $("#analysisAdvice")?.classList.remove("good", "warn", "bad");
  $(".result-screen")?.classList.remove("quality-good", "quality-warn", "quality-bad");
  updateText("#restartCaptureButton", "?대?吏 蹂寃?);
  const shareButton = $("#shareCardButton");
  if (shareButton) {
    shareButton.disabled = false;
    shareButton.textContent = "寃곌낵 ?대?吏 怨듭쑀";
  }
  updateText("#perspicaciousButton", "Perspicacious Analysis");
  setScanProgress(0, "?대?吏 ?꾩쿂由?以?, 1);
  setFlow("capture");
  renderStatuses();
  setPipeline(1);
}

bindFile("leftCameraInputMobile", "left");
bindFile("leftGalleryInputMobile", "left");
bindFile("rightCameraInputMobile", "right");
bindFile("rightGalleryInputMobile", "right");

$("#analyzeMobile")?.addEventListener("click", analyze);
$("#leftCaptureButton")?.addEventListener("click", () => openSourceSheet("left"));
$("#rightCaptureButton")?.addEventListener("click", () => openSourceSheet("right"));
$("#cameraSourceButton")?.addEventListener("click", () => triggerSource("camera"));
$("#gallerySourceButton")?.addEventListener("click", () => triggerSource("gallery"));
$("#nativeShareButton")?.addEventListener("click", nativeSharePreparedImage);
$("#openShareImageButton")?.addEventListener("click", expandSharePreview);
$("#restartCaptureButton")?.addEventListener("click", returnToCapture);
$("#reanalyzeButton")?.addEventListener("click", analyze);
$("#shareCardButton")?.addEventListener("click", () => createShareCard("summary"));
$("#perspicaciousButton")?.addEventListener("click", openPerspicaciousAnalysis);
$("#deepBackButton")?.addEventListener("click", returnFromPerspicaciousAnalysis);
$("#deepShareButton")?.addEventListener("click", () => createShareCard("deep"));

$$("[data-retake-hand]").forEach((button) => {
  button.addEventListener("click", () => openSourceSheet(button.dataset.retakeHand));
});

$$("[data-close-source]").forEach((button) => {
  button.addEventListener("click", closeSourceSheet);
});

$$("[data-close-share]").forEach((button) => {
  button.addEventListener("click", closeSharePreview);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#sourceSheet")?.classList.contains("open")) {
    closeSourceSheet();
  }
  if (event.key === "Escape" && $("#shareSheet")?.classList.contains("open")) {
    closeSharePreview();
  }
  trapSourceSheetFocus(event);
});

renderStatuses();
setPipeline(1);
setFlow("capture");

