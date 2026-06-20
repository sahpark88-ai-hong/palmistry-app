const REQUESTED_ANALYSIS_ENGINE = new URLSearchParams(window.location.search).get("engine");
const CAN_USE_REMOTE_API = ["http:", "https:"].includes(window.location.protocol);
const ANALYSIS_ENGINE =
  REQUESTED_ANALYSIS_ENGINE === "browser"
    ? "browser"
    : REQUESTED_ANALYSIS_ENGINE === "api" || CAN_USE_REMOTE_API
      ? "api"
      : "browser";
const API_ANALYSIS_ENDPOINT = "/api/palm-analysis";
const DEFAULT_ANALYSIS_ENGINE_LABEL = "브라우저 분석";
const FALLBACK_ANALYSIS_ENGINE_LABEL = "브라우저 분석(대체)";

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
  shareDataUrl: null,
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
  updateText("#sourceHandLabel", hand === "left" ? "왼손 이미지" : "오른손 이미지");
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
  updateText("#leftPreviewText", leftReady ? "선택 완료" : "대기");
  updateText("#rightPreviewText", rightReady ? "선택 완료" : "대기");
  if (analyzeButton) {
    analyzeButton.classList.remove("quality-good", "quality-warn", "quality-bad");
    if (overallQuality) analyzeButton.classList.add(`quality-${overallQuality.level}`);
    analyzeButton.disabled = step !== "analyze" || state.isAnalyzing;
    analyzeButton.setAttribute("aria-disabled", String(step !== "analyze" || state.isAnalyzing));
    analyzeButton.textContent =
      state.isAnalyzing
        ? "분석 진행 중"
        : step === "left"
        ? "왼손 이미지 필요"
        : step === "right"
          ? "오른손 이미지 필요"
          : overallQuality?.level === "bad"
            ? state.lowQualityConfirmed
              ? "참고 분석 계속"
              : "재촬영 권장 확인"
            : overallQuality?.level === "warn"
              ? "참고 분석 시작"
              : "양손 분석 시작";
  }
  updateText(
    "#readyNote",
    !leftReady
      ? "왼손부터 촬영하거나 갤러리에서 선택해 주세요."
      : !rightReady
        ? "왼손이 준비되었습니다. 이제 오른손을 선택해 주세요."
        : overallQuality?.level === "bad"
          ? "이미지 품질이 낮습니다. 다시 선택하거나 참고 분석으로 진행할 수 있습니다."
          : "양손 이미지가 준비되었습니다. 분석을 시작할 수 있습니다."
  );
  renderCaptureGuide(leftReady, rightReady);
  document.body.dataset.step = step;
}

function getEngineModeLabel() {
  if (ANALYSIS_ENGINE !== "api") return DEFAULT_ANALYSIS_ENGINE_LABEL;
  return CAN_USE_REMOTE_API ? "API 분석" : "API는 서버 필요";
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
  let title = "왼손 촬영 준비";
  let text = "손바닥 전체가 화면 중앙에 들어오고 손금이 잘 보이도록 밝은 곳에서 촬영해 주세요.";

  if (leftReady && !rightReady) {
    title = "오른손 촬영 준비";
    text = "왼손과 비슷한 거리와 밝기로 오른손 손바닥을 정면에서 촬영해 주세요.";
  } else if (leftReady && rightReady && overall?.level === "bad") {
    level = "bad";
    title = state.lowQualityConfirmed ? "참고 분석 대기" : "이미지 다시 선택 권장";
    text = state.lowQualityConfirmed
      ? "현재 사진으로 참고 분석을 진행하려면 아래 버튼을 한 번 더 눌러 주세요."
      : "손바닥이 어둡거나 흐리면 분석 신뢰도가 낮아집니다. 밝은 배경에서 다시 촬영해 주세요.";
  } else if (leftReady && rightReady && overall?.level === "warn") {
    title = "참고 분석 가능";
    text = "분석은 가능하지만 일부 선명도가 부족합니다. 더 밝게 촬영하면 결과가 안정적입니다.";
  } else if (leftReady && rightReady) {
    level = "good";
    title = "분석 준비 완료";
    text = "양손 이미지 품질이 충분합니다. 아래 버튼으로 분석을 시작해 주세요.";
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
    text.textContent = "품질 대기";
    return;
  }

  item.classList.add(`quality-${quality.level}`);
  text.textContent = handCheck?.mismatch
    ? `${handCheck.message} 쨌 ${quality.label} ${quality.total}%`
    : handCheck?.needsReview
      ? `손 방향 확인 필요 · ${quality.label} ${quality.total}%`
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
    message: mismatch ? `${detected.side === "left" ? "왼손" : "오른손"}처럼 보임` : "",
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
  const label = level === "good" ? "품질 양호" : level === "warn" ? "참고 분석" : "재촬영 권장";
  return { ...score, total, level, label };
}

async function updateHandQuality(hand) {
  if (!state[hand]) return;
  const metrics = await analyzeImageMetrics(state[hand]);
  state.quality[hand] = classifyQuality(metrics);
}

function getOverallQuality() {
  const qualities = [state.quality.left, state.quality.right].filter(Boolean);
  if (qualities.length < 2) return { level: "warn", label: "품질 확인 중" };
  if (qualities.some((item) => item.level === "bad")) return { level: "bad", label: "재촬영 권장" };
  if (qualities.some((item) => item.level === "warn")) return { level: "warn", label: "참고 분석" };
  return { level: "good", label: "품질 양호" };
}

function scoreBand(value) {
  if (value >= 72) return "high";
  if (value >= 45) return "mid";
  return "low";
}

function lineBasis(value, areaLabel) {
  const band = scoreBand(value);
  if (band === "high") return `${areaLabel} 후보 강함`;
  if (band === "mid") return `${areaLabel} 후보 보통`;
  return `${areaLabel} 후보 약함`;
}

function getAnalysisAdvice(scores, quality) {
  if (quality.level === "bad" || scores.confidence < 38) {
    return {
      level: "bad",
      title: "재촬영 권장",
      text: "손바닥 전체가 밝고 선명하게 보이도록 다시 촬영하면 더 안정적인 해석이 가능합니다.",
    };
  }

  if (quality.level === "warn" || scores.confidence < 58) {
    return {
      level: "warn",
      title: "참고 분석",
      text: "일부 선명도가 부족해 결과는 참고용입니다. 손바닥을 화면 중앙에 두면 점수가 개선됩니다.",
    };
  }

  return {
    level: "good",
    title: "분석 조건 양호",
    text: "밝기와 손금 후보선이 충분히 감지되어 현재 사진 기준으로 해석했습니다.",
  };
}

function buildInterpretation(scores, quality) {
  const life = scoreBand(scores.life);
  const head = scoreBand(scores.head);
  const heart = scoreBand(scores.heart);
  const fate = scoreBand(scores.fate);
  const prefix = quality.level === "bad" ? "사진 품질이 낮아 참고용으로 보면, " : "";

  return {
    left:
      life === "high"
        ? `${prefix}타고난 에너지와 생활 리듬이 강하게 드러나는 흐름입니다.`
        : life === "mid"
          ? `${prefix}기본 리듬은 안정적이지만 상황 변화에 따라 흐름이 달라질 수 있습니다.`
          : `${prefix}생활 리듬보다 회복과 정돈이 중요한 타입으로 해석됩니다.`,
    right:
      fate === "high"
        ? "현재 목표를 향해 실행하는 패턴이 비교적 선명합니다."
        : fate === "mid"
          ? "현재 패턴은 자연스럽게 조정되며 방향을 찾아가는 쪽에 가깝습니다."
          : "현재는 한 방향으로 몰아가기보다 선택지를 넓게 보는 흐름입니다.",
    personality:
      head === "high"
        ? "분석과 구조화를 선호하는 계획형 성향이 두드러집니다."
        : head === "mid"
          ? "직관과 현실 판단이 함께 움직이는 균형형 성향입니다."
          : "즉흥 감각과 상황 적응력이 앞서는 성향으로 보입니다.",
    emotion:
      heart === "high"
        ? "감정의 흐름이 선명하고 관계에서 표현력과 공감 신호가 강합니다."
        : heart === "mid"
          ? "감정 표현은 안정적이지만 중요한 관계에서는 속도를 조절하는 편입니다."
          : "감정을 바로 드러내기보다 관찰하고 반응하는 신중한 패턴입니다.",
    thinking:
      head === "high"
        ? "문제를 빠르게 분해하고 근거를 찾아 판단하는 방식이 강점입니다."
        : head === "mid"
          ? "큰 방향을 먼저 잡고 필요한 만큼 정보를 확인하는 사고 흐름입니다."
          : "정답을 고정하기보다 분위기와 맥락을 읽으며 움직이는 쪽입니다.",
    relation:
      heart === "high" && life !== "low"
        ? "가까운 관계에 깊게 몰입하고 오래 신뢰하려는 경향이 있습니다."
        : heart === "low"
          ? "관계에서는 속도보다 신뢰 축적을 우선하는 거리 조절형입니다."
          : "관계의 균형을 보며 필요한 만큼 표현하는 안정적인 패턴입니다.",
  };
}

function buildDetailedReport(scores, quality, interpretation, advice) {
  const dominantLine = [
    ["Life Line", scores.life],
    ["Head Line", scores.head],
    ["Heart Line", scores.heart],
    ["Fate Line", scores.fate],
  ].sort((a, b) => b[1] - a[1])[0];

  const confidenceText =
    scores.confidence >= 72
      ? "사진 조건과 손금 후보선이 비교적 선명하게 감지되었습니다."
      : scores.confidence >= 45
        ? "일부 영역은 참고 수준이지만 전체 흐름은 해석 가능합니다."
        : "사진 품질이 낮아 결과는 가벼운 참고용으로 보는 것이 좋습니다.";

  return {
    summary: `${confidenceText} 가장 강하게 열린 흐름은 ${dominantLine[0]}이며, 전체 리포트는 엔터테인먼트용 자기성찰 힌트입니다.`,
    current: `${interpretation.right} ${advice.level === "bad" ? "다시 촬영하면 더 안정적인 흐름을 볼 수 있습니다." : "지금은 방향을 넓게 보되 실행 순서를 정리하는 쪽이 어울립니다."}`,
    emotion: `${interpretation.emotion} ${interpretation.relation}`,
    advice: `${advice.text} 점수는 운명 판단이 아니라 사진에서 감지된 선명도와 후보선 강도를 바탕으로 한 참고 지표입니다.`,
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
        ? "감정적으로 따뜻하면서도 대화의 결이 잘 맞는 사람에게 끌리는 타입입니다. 단순한 감각보다 신뢰, 말의 온도, 생각의 균형을 중요하게 봅니다."
        : heartHigh
          ? "정서적으로 안정감을 주고 애정 표현이 자연스러운 사람에게 끌릴 가능성이 큽니다. 관계에서는 다정함과 진심이 오래 남는 타입입니다."
          : "처음부터 강하게 몰입하기보다 편안하게 거리를 좁혀 가는 사람에게 호감을 느끼는 흐름입니다. 부담 없는 안정감이 중요한 조건입니다.",
    romance:
      fateHigh
        ? "연애에서 방향이 정해지면 책임감 있게 관계를 이끌어 가려는 편입니다. 다만 스스로 확신이 생기기 전까지는 관찰 시간이 필요합니다."
        : "빠른 결정보다는 분위기와 상호 반응을 보며 천천히 깊어지는 쪽에 가깝습니다. 상대의 작은 변화에도 민감하게 반응하는 면이 있습니다.",
    affection:
      lifeHigh
        ? "애정 표현은 생활 속에서 챙겨주고 함께 시간을 쌓는 방식으로 드러나기 쉽습니다. 말보다 행동으로 안정감을 주는 타입에 가깝습니다."
        : "애정은 깊지만 표현 속도는 신중한 편입니다. 마음을 열기 전에는 조심스럽지만 신뢰가 생기면 오래 관계를 지키려는 흐름입니다.",
    intimacy:
      headHigh
        ? "친밀감에서는 감정의 속도보다 신뢰와 심리적 안정감을 먼저 확인하려는 경향이 있습니다. 가까워질수록 배려와 대화가 중요한 기준이 됩니다."
        : "친밀감은 분위기와 감정 교류의 영향을 많이 받는 흐름입니다. 즉흥적인 끌림보다 서로 편안하다고 느끼는 시간이 자연스럽게 깊어지는 타입입니다.",
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
  const fallback = createAnalysisResult(scores, fallbackQuality, result?.engineLabel || "AI 분석");

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
    const nextStep = !state.left ? "왼손" : "오른손";
    updateText("#mobileProgress", `${nextStep} 필요`);
    document.body.dataset.step = !state.left ? "left" : "right";
    return;
  }

  const overallQuality = getOverallQuality();
  if (overallQuality.level === "bad" && !state.lowQualityConfirmed) {
    state.lowQualityConfirmed = true;
    renderStatuses();
    updateText("#readyNote", "재촬영을 권장합니다. 그래도 진행하려면 분석 버튼을 한 번 더 눌러 주세요.");
    return;
  }

  state.isAnalyzing = true;
  document.body.classList.add("analyzing");
  renderStatuses();
  setFlow("scanning");
  setScanProgress(18, "손바닥 영역 추출 중", 2);
  setPipeline(2);
  updateText("#mobileProgress", "42%");

  setTimeout(() => {
    setPipeline(3);
    updateText("#mobileProgress", "78%");
    setScanProgress(58, "손금 후보 탐색 중", 3);
  }, 650);

  setTimeout(async () => {
    try {
      setScanProgress(82, "이미지 특징 계산 중", 3);
      const result = await runPalmAnalysis();
      state.analysisResult = result;
      state.scores = result.scores;
      state.analysisEngineLabel = result.engineLabel;
      renderResults();
      setPipeline(4);
      updateText("#mobileProgress", `${state.scores.confidence}%`);
      setScanProgress(100, "해석 리포트 생성 완료", 4);
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
  updateText("#lifeBasis", lineBasis(scores.life, "좌하단"));
  updateText("#headBasis", lineBasis(scores.head, "중앙 가로"));
  updateText("#heartBasis", lineBasis(scores.heart, "상단 가로"));
  updateText("#fateBasis", lineBasis(scores.fate, "중앙 세로"));
  updateText("#resultQualityText", quality.label);
  const summary = $(".quality-summary");
  summary?.classList.remove("good", "warn", "bad");
  summary?.classList.add(quality.level);
  const resultScreen = $(".result-screen");
  resultScreen?.classList.remove("quality-good", "quality-warn", "quality-bad");
  resultScreen?.classList.add(`quality-${quality.level}`);
  const restartButton = $("#restartCaptureButton");
  if (restartButton) {
    restartButton.textContent = quality.level === "bad" ? "다시 촬영하기" : "이미지 변경";
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
  state.shareDataUrl = null;
  const previewImage = $("#sharePreviewImage");
  const downloadLink = $("#downloadShareImageLink");
  const reader = new FileReader();
  reader.onload = () => {
    state.shareDataUrl = String(reader.result || "");
    if (previewImage) previewImage.src = state.shareDataUrl;
    if (downloadLink) downloadLink.href = state.shareDataUrl;
  };
  reader.readAsDataURL(blob);
  $("#shareSheet")?.classList.add("open");
  $("#shareSheet")?.classList.add("expanded");
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
  $("#shareSheet")?.classList.add("expanded");
  $("#sharePreviewImage")?.scrollIntoView({ block: "center" });
  updateText("#mobileResultScore", "길게 눌러 저장");
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
    updateText("#mobileResultScore", "분석 필요");
    return;
  }
  if (state.isSharing) return;
  setShareBusy(true);

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = mode === "deep" ? 2860 : 3920;
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

  const glow = ctx.createRadialGradient(540, 450, 80, 540, 450, 520);
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
  ctx.arc(540, 500, 240, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 77, 255, 0.72)";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(390, 625);
  ctx.bezierCurveTo(350, 500, 420, 370, 530, 330);
  ctx.stroke();
  ctx.strokeStyle = "rgba(32, 240, 255, 0.84)";
  ctx.beginPath();
  ctx.moveTo(330, 520);
  ctx.bezierCurveTo(450, 470, 650, 470, 760, 535);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(375, 410);
  ctx.bezierCurveTo(505, 465, 660, 445, 760, 370);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(560, 700);
  ctx.bezierCurveTo(525, 590, 555, 455, 620, 335);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 58px Arial, sans-serif";
  ctx.fillText(`분석 신뢰도 ${scores.confidence}%`, 540, 830);

  ctx.fillStyle = quality.level === "bad" ? "#ff7a8a" : quality.level === "warn" ? "#ffd166" : "#49ffb3";
  ctx.font = "900 30px Arial, sans-serif";
  ctx.fillText(`이미지 품질: ${quality.label}`, 540, 885);

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
    const y = 950 + row * 145;
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
  ctx.roundRect(110, 1275, 860, 250, 24);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#20f0ff";
  ctx.font = "900 30px Arial, sans-serif";
  ctx.fillText(advice.title, 150, 1330);
  ctx.fillStyle = "#f4fbff";
  ctx.font = "700 30px Arial, sans-serif";
  drawWrappedText(ctx, report.summary, 150, 1385, 780, 40, 2);
  ctx.fillStyle = "#ffc9d0";
  ctx.font = "600 24px Arial, sans-serif";
  drawWrappedText(ctx, report.advice, 150, 1470, 780, 32, 2);

  const summaryItems = [
    ["왼손", interpretation.left],
    ["오른손", interpretation.right],
    ["성향", interpretation.personality],
    ["감정", interpretation.emotion],
    ["사고", interpretation.thinking],
    ["관계", interpretation.relation],
    ["핵심 요약", report.summary],
    ["현재 흐름", report.current],
    ["감정과 관계", report.emotion],
    ["오늘의 조언", report.advice],
  ];
  const deepItems = [
    ["이상형 성향", deepReport.ideal],
    ["연애 성향", deepReport.romance],
    ["애정 성향", deepReport.affection],
    ["성적 성향", deepReport.intimacy],
  ];
  const reportItems = mode === "deep" ? deepItems : summaryItems;

  const cardHeight = mode === "deep" ? 250 : 202;
  const cardGap = mode === "deep" ? 26 : 18;
  let reportY = 1600;
  reportItems.forEach(([title, text]) => {
    ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
    ctx.strokeStyle = "rgba(126, 245, 255, 0.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(110, reportY, 860, cardHeight, 18);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#20f0ff";
    ctx.font = "900 24px Arial, sans-serif";
    ctx.fillText(title, 145, reportY + 38);
    ctx.fillStyle = "#f4fbff";
    ctx.font = "600 23px Arial, sans-serif";
    drawWrappedText(ctx, text, 145, reportY + 78, 790, 31, mode === "deep" ? 5 : 4);
    reportY += cardHeight + cardGap;
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "#93a8ba";
  ctx.font = "700 24px Arial, sans-serif";
  ctx.fillText("엔터테인먼트 및 자기성찰 목적의 참고 리포트", 540, reportY + 38);

  canvasToPngBlob(canvas)
    .then((blob) => shareOrDownloadCard(blob, scores))
    .catch(() => updateText("#mobileResultScore", "공유취소"))
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
  state.shareDataUrl = null;
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
  updateText("#summaryReport", "양손의 주요 흐름을 바탕으로 현재 성향과 리듬을 요약합니다.");
  updateText("#currentReport", "최근 선택과 실행 흐름을 참고해 해석합니다.");
  updateText("#emotionReport", "감정 표현과 관계 패턴을 함께 해석합니다.");
  updateText("#adviceReport", "결과를 자기성찰 힌트로 가볍게 활용해 주세요.");
  updateText("#deepResultScore", "--");
  updateText("#idealTypeInsight", "상대에게 기대하는 정서적 안정감과 끌림의 방향을 해석합니다.");
  updateText("#romanceInsight", "관계가 시작되고 깊어질 때의 속도와 표현 방식을 해석합니다.");
  updateText("#affectionInsight", "애정을 주고받는 방식과 친밀감의 리듬을 참고합니다.");
  updateText("#intimacyInsight", "친밀감, 신뢰, 거리감의 흐름을 중심으로 해석합니다.");
  updateText("#analysisAdviceTitle", "분석 기준 확인 중");
  updateText("#analysisAdviceText", "양손 사진의 밝기, 선명도, 손금 후보선을 함께 확인합니다.");
  $(".quality-summary")?.classList.remove("good", "warn", "bad");
  $("#analysisAdvice")?.classList.remove("good", "warn", "bad");
  $(".result-screen")?.classList.remove("quality-good", "quality-warn", "quality-bad");
  updateText("#restartCaptureButton", "이미지 변경");
  const shareButton = $("#shareCardButton");
  if (shareButton) {
    shareButton.disabled = false;
    shareButton.textContent = "결과 이미지 공유";
  }
  updateText("#perspicaciousButton", "Perspicacious Analysis");
  setScanProgress(0, "이미지 전처리 중", 1);
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
closeSharePreview();




