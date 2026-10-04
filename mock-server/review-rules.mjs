/**
 * Deterministic stand-in for the LLM review pipeline. It only exists so the UI can be
 * demoed and tested end-to-end without the Python service. Offsets are UTF-16 code unit
 * indices into the submitted content, matching the API contract.
 */

const SPELLING = {
  recieve: 'receive',
  recieved: 'received',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  untill: 'until',
  accomodate: 'accommodate',
  buisness: 'business',
  managment: 'management',
  enviroment: 'environment',
  acheive: 'achieve',
  acheived: 'achieved',
  wich: 'which',
  teh: 'the',
  comittee: 'committee',
  aquire: 'acquire',
  publically: 'publicly',
  goverment: 'government',
  existance: 'existence',
  reccomend: 'recommend',
  reccomendations: 'recommendations',
  independant: 'independent',
  calender: 'calendar',
};

/** @type {{ pattern: RegExp, severity: string, fix: (m: RegExpExecArray) => string, explain: string }[]} */
const GRAMMAR = [
  {
    pattern: /\b(could|should|would|must|might) of\b/gi,
    severity: 'medium',
    fix: (m) => `${m[1]} have`,
    explain: '"Of" is not a verb. Use "have" after modal verbs such as could, should and would.',
  },
  {
    pattern: /\b(\w{2,})\s+\1\b/gi,
    severity: 'low',
    fix: (m) => m[1],
    explain: 'The same word appears twice in a row.',
  },
  {
    pattern: /\balot\b/gi,
    severity: 'low',
    fix: () => 'a lot',
    explain: '"A lot" is always written as two words.',
  },
  {
    pattern: /\birregardless\b/gi,
    severity: 'low',
    fix: () => 'regardless',
    explain: '"Irregardless" is nonstandard; use "regardless".',
  },
  {
    pattern:
      /\ba (increase|estimate|update|issue|error|example|order|hour|overview|average|analysis|independent|audit|annual)\b/gi,
    severity: 'low',
    fix: (m) => `an ${m[1]}`,
    explain: 'Use "an" before words that begin with a vowel sound.',
  },
  {
    pattern: /\b(the data|the numbers|the results) (shows|suggests|indicates)\b/gi,
    severity: 'low',
    fix: (m) => `${m[1]} ${m[2].replace(/s$/, '')}`,
    explain: 'Subject–verb agreement: a plural subject takes a plural verb.',
  },
  {
    pattern: /\bwe was\b/gi,
    severity: 'medium',
    fix: () => 'we were',
    explain: 'Subject–verb agreement: "we" takes "were".',
  },
  {
    pattern: /\bless (customers|complaints|shipments|errors|people|incidents|orders)\b/gi,
    severity: 'low',
    fix: (m) => `fewer ${m[1]}`,
    explain: 'Use "fewer" with countable nouns.',
  },
];

const VULGAR = [
  { term: 'bullshit', severity: 'high', suggestion: 'unfounded' },
  { term: 'damn', severity: 'medium', suggestion: null },
  { term: 'crap', severity: 'medium', suggestion: 'poor-quality' },
  { term: 'pissed off', severity: 'high', suggestion: 'frustrated' },
  { term: 'screwed up', severity: 'medium', suggestion: 'mishandled' },
  { term: 'sucks', severity: 'medium', suggestion: 'is underperforming' },
];

function preserveCase(original, replacement) {
  if (
    original[0] &&
    original[0] === original[0].toUpperCase() &&
    original[0] !== original[0].toLowerCase()
  ) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * @param {string} content
 * @param {() => string} newId
 */
export function analyze(content, newId) {
  const findings = [];
  const push = (category, severity, start, end, suggestion, explanation) =>
    findings.push({
      id: newId(),
      category,
      severity,
      excerpt: content.slice(start, end),
      ...(suggestion ? { suggestion } : {}),
      explanation,
      range: { start, end },
      status: 'pending',
    });

  const wordRe = /[A-Za-z]+/g;
  for (let m; (m = wordRe.exec(content));) {
    const fix = SPELLING[m[0].toLowerCase()];
    if (fix) {
      push(
        'spelling',
        'low',
        m.index,
        m.index + m[0].length,
        preserveCase(m[0], fix),
        `"${m[0]}" is misspelled.`,
      );
    }
  }

  for (const rule of GRAMMAR) {
    rule.pattern.lastIndex = 0;
    for (let m; (m = rule.pattern.exec(content));) {
      push(
        'grammar',
        rule.severity,
        m.index,
        m.index + m[0].length,
        preserveCase(m[0], rule.fix(m)),
        rule.explain,
      );
    }
  }

  for (const { term, severity, suggestion } of VULGAR) {
    const re = new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`, 'gi');
    for (let m; (m = re.exec(content));) {
      push(
        'vulgar_language',
        severity,
        m.index,
        m.index + m[0].length,
        suggestion,
        suggestion
          ? 'This language is unprofessional for a business document. Consider a neutral alternative.'
          : 'This language is unprofessional for a business document. Remove it or rephrase the sentence.',
      );
    }
  }

  return findings.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
}
