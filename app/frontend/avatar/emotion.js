/* Turns a reply into timed facial-expression and gesture cues (simple word and punctuation rules, runs locally). */
'use strict';
(function (root) {
  const LEX = {
    laugh: ['haha', 'hehe', 'lol', 'funny', 'hilarious', 'joke', 'kidding', '😂', '🤣', '😄', '😆'],
    happy: ['great', 'glad', 'happy', 'love', 'awesome', 'wonderful', 'nice', 'good', 'fun', 'excited', 'congrats', 'congratulations', 'yay', 'enjoy', 'delighted', 'thanks', 'thank', 'welcome', 'cool', 'perfect', 'sweet', 'brilliant', 'proud', 'hello', 'hey', 'hi', '😊', '🙂', '😀', '❤', '👍', '🎉'],
    sad: ['sorry', 'sad', 'unfortunately', 'miss', 'lost', 'loss', 'hurts', 'painful', 'tough', 'lonely', 'cry', 'grief', 'died', 'sadly', 'regret', 'depressed', 'exhausted', 'heartbreaking', '😢', '😞', '😔'],
    concerned: ['worried', 'worry', 'careful', 'anxious', 'stress', 'stressed', 'scared', 'afraid', 'concern', 'concerned', 'risk', 'dangerous', 'trouble', 'problem', 'hurt', 'safe'],
    surprised: ['wow', 'whoa', 'seriously', 'unexpected', 'suddenly', 'incredible', 'amazing', 'surprise', 'surprised', 'shocked', 'unbelievable', 'really', '😮', '😲', '🤯'],
    angry: ['angry', 'furious', 'annoying', 'annoyed', 'unfair', 'hate', 'terrible', 'awful', 'frustrating', 'frustrated', '😠', '😡'],
    thinking: ['hmm', 'think', 'maybe', 'perhaps', 'wonder', 'consider', 'might', 'possibly', 'depends', 'curious', 'interesting', 'let me', '🤔'],
  };
  const EXPR = { laugh: ['laugh', 0.9], happy: ['happy', 0.7], sad: ['sad', 0.8], concerned: ['concerned', 0.8], surprised: ['surprised', 0.8], angry: ['angry', 0.55], thinking: ['thinking', 0.8] };
  const GESTURES = [
    ['wave', /\b(hi|hello|hey|hiya|howdy|good (morning|evening|afternoon)|goodbye|bye|see you|welcome back)\b/],
    ['shrug', /\b(i don'?t know|not sure|who knows|no idea|it depends|either way|hard to say)\b/],
    ['cheer', /\b(congrats|congratulations|yay|woohoo|well done|you did it)\b/],
    ['shake', /\b(no|nope|not really|don'?t think|never|can'?t|cannot|unfortunately)\b/],
    ['nod', /\b(yes|yeah|exactly|right|sure|of course|absolutely|indeed|agree|true|definitely|that makes sense|makes sense|okay|ok)\b/],
    ['think', /\b(hmm|let me think|i wonder|thinking about)\b/],
  ];

  function score(sentence) {
    const low = sentence.toLowerCase();
    const words = low.match(/[a-z']+/g) || [];
    const set = new Set(words);
    const out = {};
    for (const [k, list] of Object.entries(LEX)) {
      let s = 0;
      for (const w of list) {
        if (/^[a-z']+$/.test(w)) { if (set.has(w)) s += 1; } else if (low.includes(w)) s += 1;
      }
      if (s) out[k] = s;
    }
    return out;
  }

  /* returns [{start (char offset), expr, amt, gesture|null}] */
  function analyze(text) {
    const cues = [];
    const re = /[^.!?\n]+[.!?…]*\s*/g;
    let m, sinceGesture = 0, first = true;
    while ((m = re.exec(text))) {
      const s = m[0];
      if (!s.trim()) continue;
      const sc = score(s);
      let best = null, bestV = 0;
      for (const [k, v] of Object.entries(sc)) if (v > bestV) { best = k; bestV = v; }
      let expr = 'happy', amt = 0.22;                       // friendly baseline while talking
      if (best) { expr = EXPR[best][0]; amt = Math.min(1, EXPR[best][1] + 0.08 * (bestV - 1)); }
      else if (/\?\s*$/.test(s.trim())) { expr = 'curious'; amt = 0.8; }
      else if (/!\s*$/.test(s.trim())) { expr = 'happy'; amt = 0.6; }
      let gesture = null;
      for (const [g, rx] of GESTURES) if (rx.test(s.toLowerCase())) { gesture = g; break; }
      if (first && !gesture && /^\W*(hi|hello|hey)\b/i.test(s)) gesture = 'wave';
      if (!gesture) { sinceGesture++; if (sinceGesture >= 2 && s.length > 30) { gesture = 'explain'; sinceGesture = 0; } }
      else sinceGesture = 0;
      cues.push({ start: m.index, expr, amt, gesture });
      first = false;
    }
    return cues;
  }

  /* quick mood read of the user's own words, used only to colour the avatar's listening face */
  function mood(text) {
    const sc = score(text || '');
    let best = null, v = 0;
    for (const [k, n] of Object.entries(sc)) if (n > v) { best = k; v = n; }
    return best;
  }

  root.Emotion = { analyze, mood };
})(typeof window !== 'undefined' ? window : globalThis);
