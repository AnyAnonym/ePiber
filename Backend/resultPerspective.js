const SCORE = "\\d{1,2}-\\d{1,2}(?:\\(\\d{1,2}\\))?";
const RESULT_PATTERN = new RegExp(`^${SCORE}(?:/${SCORE})*$`);

function validResult(value) {
  return RESULT_PATTERN.test(String(value || ""));
}

function reverseResultPerspective(value) {
  return String(value || "").split("/").map((set) => set.replace(/^(\d{1,2})-(\d{1,2})(\(\d{1,2}\))?$/, "$2-$1$3")).join("/");
}

function normalizeWinnerPerspective(value) {
  const result = String(value || "");
  if (!validResult(result)) return result;
  const wins = result.split("/").reduce((count, set) => {
    const [first, second] = set.replace(/\(\d+\)$/, "").split("-").map(Number);
    if (first > second) count[0]++;
    if (second > first) count[1]++;
    return count;
  }, [0, 0]);
  return wins[1] > wins[0] ? reverseResultPerspective(result) : result;
}

module.exports = { validResult, reverseResultPerspective, normalizeWinnerPerspective };
