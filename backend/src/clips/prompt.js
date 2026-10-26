const config = require('../config');

/**
 * The rules for proposing clips, shared by the analysis pass (which proposes clips as
 * it reads the transcript) and the fallback detector (used only if analysis produced
 * no proposals), so the two can never drift apart on what a good clip is.
 */
function clipProposalInstructions(quota) {
  const { clipMinDurationSeconds: minSec, clipMaxDurationSeconds: maxSec } = config.limits;
  return `Propose up to ${quota} short-form clip${quota === 1 ? '' : 's'} (for TikTok, Reels and Shorts, where a viewer decides within 1-3 seconds whether to keep watching). Each clip is ONE topic and must:
- START at the line where the HOOK is first spoken: a line that grabs attention by itself, such as a surprising or counterintuitive claim ("Most people get this backwards"), a question the viewer wants answered, a concrete number up front, a consequence stated before its explanation ("This one mistake cost us six months"), or direct address to the viewer's situation ("If you've ever tried X and failed..."). Do not start on lead-up, throat-clearing, or a transition ("so anyway", "today I want to talk about"). If the hook line comes a few lines after the topic begins, startLine is the hook line, not the lead-up.
- RUN THROUGH the line where that topic's explanation is complete, ending on a real conclusion, so it makes sense without outside context. endLine is that last line.
- Last roughly ${minSec}-${maxSec} seconds of speech (use the time markers to judge).
- Not overlap another proposed clip; each covers a different topic.
"hook" is the opening words exactly as spoken at startLine, verbatim, not a paraphrase or a title. "score" is 0-100 for how likely the clip is to hold viewers.`;
}

module.exports = { clipProposalInstructions };
