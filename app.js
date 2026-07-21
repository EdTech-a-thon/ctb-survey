let customRules = [
  { id: 1, varIndex: "1", type: "square", min: 4, max: 100, step: 1, formula: "" },
];

const elements = {
  template: document.querySelector("#templateInput"),
  min: document.querySelector("#minValue"),
  max: document.querySelector("#maxValue"),
  decimals: document.querySelector("#decimalPlaces"),
  excludeZero: document.querySelector("#excludeZero"),
  rules: document.querySelector("#rulesList"),
  results: document.querySelector("#resultsList"),
  generate: document.querySelector("#generateBtn"),
  addRule: document.querySelector("#addRuleBtn"),
};

function getRandomValue(min, max, excludeZero, decimals = 0) {
  const factor = 10 ** decimals;
  const scaledMin = Math.ceil(min * factor);
  const scaledMax = Math.floor(max * factor);

  if (scaledMin > scaledMax) return min;

  const validValues = scaledMax - scaledMin + 1;
  if (excludeZero && scaledMin === 0 && scaledMax === 0) return 0;

  let value;
  do {
    const raw = Math.floor(Math.random() * validValues) + scaledMin;
    value = Number((raw / factor).toFixed(decimals));
  } while (excludeZero && value === 0);

  return value;
}

function cleanMathFormatting(expression) {
  return expression
    .replace(/\+\s*-/g, "- ")
    .replace(/-\s*-/g, "+ ")
    .replace(/\b1([a-zA-Z])/g, "$1")
    .replace(/\b-1([a-zA-Z])/g, "-$1")
    .replace(/\+\s*0\b/g, "")
    .replace(/-\s*0\b/g, "");
}

function formatToLatex(expression, forDocs = false) {
  let result = expression
    .replace(/\\?sqrt\(([^)]+)\)/g, "\\sqrt{$1}")
    .replace(/\\?sqrt\{([^}]+)\}/g, "\\sqrt{$1}");
  const fractionCommand = forDocs ? "\\frac" : "\\dfrac";

  for (let pass = 0; pass < 10; pass += 1) {
    const previous = result;
    result = result.replace(
      /((?:\([^)]+\)|[a-zA-Z0-9_.\-]+))\s*\/\/\s*((?:\([^)]+\)|[a-zA-Z0-9_.\-]+))/g,
      (_match, numerator, denominator) => {
        const cleanNumerator = numerator.trim().replace(/^\((.*)\)$/, "$1");
        const cleanDenominator = denominator.trim().replace(/^\((.*)\)$/, "$1");
        return `${fractionCommand}{${cleanNumerator}}{${cleanDenominator}}`;
      },
    );
    if (result === previous) break;
  }

  return result;
}

function evaluateVariable(rule, assigned, settings) {
  if (!rule) {
    return getRandomValue(settings.min, settings.max, settings.excludeZero, settings.decimals);
  }

  const min = Number.isFinite(rule.min) ? rule.min : settings.min;
  const max = Number.isFinite(rule.max) ? rule.max : settings.max;

  if (rule.type === "range") {
    return getRandomValue(Math.min(min, max), Math.max(min, max), settings.excludeZero, settings.decimals);
  }

  if (rule.type === "square") {
    const effectiveMin = Math.max(0, Math.min(min, max));
    const effectiveMax = Math.max(effectiveMin, Math.max(min, max));
    const rootMin = Math.ceil(Math.sqrt(effectiveMin));
    const rootMax = Math.floor(Math.sqrt(effectiveMax));
    const root = rootMin > rootMax ? rootMin : getRandomValue(rootMin, rootMax, false, 0);
    return root * root;
  }

  if (rule.type === "multiple") {
    const step = Math.abs(rule.step) || 1;
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    const multiplierMin = Math.ceil(lower / step);
    const multiplierMax = Math.floor(upper / step);
    const multiplier = multiplierMin > multiplierMax
      ? multiplierMin
      : getRandomValue(multiplierMin, multiplierMax, settings.excludeZero, 0);
    return Number((multiplier * step).toFixed(settings.decimals || 2));
  }

  if (rule.type === "formula") {
    const expression = rule.formula.replace(/\bR\((\d+)\)/g, (_match, index) => assigned[`R(${index})`] ?? 0);
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      return Number.isFinite(Number(result)) ? Number(Number(result).toFixed(settings.decimals || 2)) : 0;
    } catch {
      return 0;
    }
  }

  return getRandomValue(settings.min, settings.max, settings.excludeZero, settings.decimals);
}

function generateQuestion(template, settings) {
  const assigned = {};
  const rulesByVariable = Object.fromEntries(customRules.map((rule) => [`R(${rule.varIndex})`, rule]));

  const result = template
    .replace(/\bR\((\d+)\)/g, (_match, index) => {
      const key = `R(${index})`;
      if (!(key in assigned)) assigned[key] = evaluateVariable(rulesByVariable[key], assigned, settings);
      return assigned[key];
    })
    .replace(/\bR(?!\()/g, () => getRandomValue(settings.min, settings.max, settings.excludeZero, settings.decimals));

  return { question: cleanMathFormatting(result), variables: assigned };
}

function getSettings() {
  let min = Number.parseFloat(elements.min.value);
  let max = Number.parseFloat(elements.max.value);
  if (!Number.isFinite(min)) min = -10;
  if (!Number.isFinite(max)) max = 10;
  if (min > max) [min, max] = [max, min];

  return {
    min,
    max,
    decimals: Number.parseInt(elements.decimals.value, 10) || 0,
    excludeZero: elements.excludeZero.checked,
  };
}

function ruleField(label, content, className = "") {
  return `<div class="mini-field ${className}"><label>${label}</label>${content}</div>`;
}

function renderRules() {
  if (customRules.length === 0) {
    elements.rules.innerHTML = '<p class="empty-rules">No custom rules yet. Every variable will use the global settings.</p>';
    return;
  }

  elements.rules.innerHTML = customRules.map((rule, index) => {
    const variable = ruleField(
      "Variable",
      `<div class="variable-input"><span>R(</span><input aria-label="Variable number" type="number" min="1" max="99" value="${rule.varIndex}" data-index="${index}" data-field="varIndex"><span>)</span></div>`,
    );
    const type = ruleField(
      "Rule type",
      `<select aria-label="Rule type" data-index="${index}" data-field="type">
        <option value="range" ${rule.type === "range" ? "selected" : ""}>Specific range</option>
        <option value="square" ${rule.type === "square" ? "selected" : ""}>Perfect square</option>
        <option value="multiple" ${rule.type === "multiple" ? "selected" : ""}>Multiple / step</option>
        <option value="formula" ${rule.type === "formula" ? "selected" : ""}>Formula</option>
      </select>`,
    );
    let extraFields = "";

    if (rule.type === "formula") {
      extraFields = ruleField(
        "Formula",
        `<input aria-label="Formula" type="text" value="${escapeAttribute(rule.formula)}" placeholder="R(1) * 2 + 0.5" data-index="${index}" data-field="formula">`,
        "formula-field",
      );
    } else {
      extraFields += ruleField("Min output", `<input aria-label="Minimum output" type="number" step="any" value="${rule.min}" data-index="${index}" data-field="min">`);
      extraFields += ruleField("Max output", `<input aria-label="Maximum output" type="number" step="any" value="${rule.max}" data-index="${index}" data-field="max">`);
      if (rule.type === "multiple") {
        extraFields += ruleField("Step", `<input aria-label="Step" type="number" step="any" value="${rule.step}" data-index="${index}" data-field="step">`);
      }
    }

    return `<div class="rule-row is-${rule.type}">
      ${variable}${type}${extraFields}
      <button class="delete-rule" type="button" data-delete="${index}" aria-label="Delete rule for R(${rule.varIndex})">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10M9 9v4M11 9v4" /></svg>
      </button>
    </div>`;
  }).join("");
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function copyToClipboard(text, button) {
  const showSuccess = () => {
    button.classList.add("copied");
    button.innerHTML = '<svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" /></svg> Copied';
    window.setTimeout(() => {
      button.classList.remove("copied");
      button.innerHTML = '<svg viewBox="0 0 20 20"><path d="M7 7V4h9v9h-3M4 7h9v9H4Z" /></svg> Copy LaTeX';
    }, 1800);
  };

  try {
    await navigator.clipboard.writeText(text);
    showSuccess();
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.cssText = "position:fixed;opacity:0";
    document.body.append(textArea);
    textArea.select();
    const copied = document.execCommand("copy");
    textArea.remove();
    if (copied) showSuccess();
  }
}

function renderSamples() {
  const template = elements.template.value.trim() || "sqrt(R(1)) + (x + R(2)) // R(2) = 10";
  const settings = getSettings();

  elements.results.innerHTML = Array.from({ length: 4 }, (_, index) => {
    const data = generateQuestion(template, settings);
    const displayLatex = formatToLatex(data.question);
    const docsLatex = formatToLatex(data.question, true);
    const math = window.katex
      ? window.katex.renderToString(displayLatex, { throwOnError: false, displayMode: false })
      : escapeAttribute(data.question);
    const variables = Object.entries(data.variables).length
      ? Object.entries(data.variables).map(([key, value]) => `<span class="variable-pill">${key} = ${value}</span>`).join("")
      : '<span class="no-variables">No reusable variables in this template</span>';

    return `<article class="result-card">
      <div class="result-top">
        <span class="sample-number">Question ${String(index + 1).padStart(2, "0")}</span>
        <button class="copy-button" type="button" data-latex="${escapeAttribute(docsLatex)}">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 7V4h9v9h-3M4 7h9v9H4Z" /></svg> Copy LaTeX
        </button>
      </div>
      <div class="math-display">${math}</div>
      <div class="variables">${variables}</div>
    </article>`;
  }).join("");
}

elements.rules.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
  const index = Number(target.dataset.index);
  const field = target.dataset.field;
  if (!field || !customRules[index]) return;
  customRules[index][field] = ["min", "max", "step"].includes(field) ? Number.parseFloat(target.value) || 0 : target.value;
  renderSamples();
});

elements.rules.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.dataset.field === "type") renderRules();
});

elements.rules.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  customRules.splice(Number(button.dataset.delete), 1);
  renderRules();
  renderSamples();
});

elements.results.addEventListener("click", (event) => {
  const button = event.target.closest(".copy-button");
  if (button) copyToClipboard(button.dataset.latex, button);
});

elements.addRule.addEventListener("click", () => {
  const usedIndexes = customRules.map((rule) => Number(rule.varIndex));
  const nextIndex = Math.max(0, ...usedIndexes) + 1;
  customRules.push({ id: Date.now(), varIndex: String(nextIndex), type: "range", min: 1, max: 10, step: 1, formula: "" });
  renderRules();
  renderSamples();
});

elements.generate.addEventListener("click", renderSamples);
[elements.template, elements.min, elements.max, elements.decimals, elements.excludeZero].forEach((element) => {
  element.addEventListener("input", renderSamples);
  element.addEventListener("change", renderSamples);
});

window.addEventListener("load", renderSamples);
renderRules();
renderSamples();
