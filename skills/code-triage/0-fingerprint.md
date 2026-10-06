# code-triage · §0 The fingerprint and the short-circuit

Reference for [`code-triage`](SKILL.md) §0. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


This skill was built to run once, be read, and end. It is now **pinged on a loop**: a
long-lived session per repo, re-run whenever it goes idle. A full pass on a ~30-issue
backlog is roughly 35-60 network calls and ~60 local ones. On a re-run 30 minutes later
with no new commits, issues or claims, **about 4 of those ~50 carry new information** —
the gather, the shipped-verification, the grouping and the ordering are pure functions of
inputs that did not move, and re-derive a byte-identical answer.

So the first thing this skill does is decide whether it needs to run at all.

**Measured, #244: this was not happening.** A six-week census of one adopting fleet found
code-triage's median run cost **24 tool calls (p90 40) over 1,722 runs** — 8x the
documented three — and code-sweep's median was **27 (p90 59) over 372 runs**. Neither
gap was read amplification (0 median duplicate file reads) or the skill body reloading
mid-run (well under one `Skill` invocation per run). Two causes, both fixed below: inputs 2
and 5 were broad enough to read "changed" on nearly every ping (a bare comment; any push
to any branch, including `code-wrap`'s routine backup push), and — found only once this
was traced against a real checkout — **the persisted record itself had no specified
shape**, so two model-executed runs stored two different partial things and the "cache is
never an authority" rule then correctly forced a full pass regardless of what moved. A
third cause is not fixable from inside this repo at all: nothing outside the executing
agent's own compliance verifies §0 ran, so a skipped §0 and a §0 that ran and found
genuine change are indistinguishable in a transcript. §0 below narrows what it can, and
gives the third cause a receipt instead of pretending to enforce it — see the outcome-line
and cache-record requirements after the fingerprint.

**The fingerprint — five inputs, three network calls:**

```sh
GITDIR="$(git rev-parse --path-format=absolute --git-common-dir)"
CACHE="$GITDIR/colab-triage.json"
REPO="$(dirname "$GITDIR")"      # the MAIN checkout — see the note on input 4

git fetch origin --quiet && git rev-parse origin/<trunk>          # 1. trunk sha

OUT2=$(gh issue list --state open --limit 100 --json number,state,title,body,labels \
  -q '"N2 \(length)", (.[]|"I \(.number) \(.state) \([.labels[].name]|sort|join(","))\t\(.title)\t\(.body|@base64)")')
                                                                    # 2. backlog digest — network call now,
                                                                    #    receipt/digest decided below once input 3's TOTAL is in hand
NWO=$(gh repo view --json nameWithOwner -q .nameWithOwner)        # 3. dependency digest
OUT=$(gh api graphql -F owner="${NWO%%/*}" -F name="${NWO##*/}" -f query='
  query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){
    issues(states:OPEN,first:100){ totalCount pageInfo{ hasNextPage }
      nodes{ number blocking(first:1){ totalCount }
        blockedBy(first:20){ totalCount nodes{ number state repository{ nameWithOwner } } } } } } }' \
  -q '"COV \(.data.repository.issues.totalCount) \(.data.repository.issues.nodes|length) \(.data.repository.issues.pageInfo.hasNextPage)",
      (.data.repository.issues.nodes[]|"DEP \(.number):\(.blockedBy.totalCount):\(.blocking.totalCount)"),
      (.data.repository.issues.nodes[]|. as $i|.blockedBy.nodes[]|"BY \($i.number) \(.repository.nameWithOwner)#\(.number) \(.state)")')

COV=$(printf '%s\n' "$OUT" | grep '^COV ')                        # ← the read's own receipt
read -r _ TOTAL FETCHED MORE <<< "$COV"                           # zsh: never `set -- $COV`
if   [ -z "$COV" ]; then echo "REFUSING to digest: dependency read returned nothing → full pass"
elif [ "$TOTAL" != "$FETCHED" ] || [ "$MORE" != false ]; then
     echo "TRUNCATED: $FETCHED of $TOTAL open issues → paginate, full pass (so do inputs 2 and §1)"
else printf '%s\n' "$COV" "$(printf '%s\n' "$OUT" | grep -e '^DEP ' -e '^BY ' | sort)" \
       | shasum -a 256 | cut -c1-16
fi

N2=$(printf '%s\n' "$OUT2" | grep '^N2 ')                         # ← input 2's own receipt
read -r _ N2COUNT <<< "$N2"
if   [ -z "$N2" ]; then echo "REFUSING to digest: backlog read returned nothing → full pass"
elif [ -z "$COV" ] || [ "$N2COUNT" != "$TOTAL" ]; then
     echo "TRUNCATED: $N2COUNT open issues read, $TOTAL reported by input 3 → full pass"
else printf '%s\n' "$(printf '%s\n' "$OUT2" | grep '^I ' | sort)" \
       | shasum -a 256 | cut -c1-16                                # 2. backlog digest
fi

python3 -c 'import json,os,sys                                    # 4. claim digest (local, 0 calls)
r=os.path.realpath(sys.argv[1]); s=json.load(open(os.path.expanduser("~/.colab/state.json")))
print(sorted(k for k,v in s.get("claims",{}).items() if os.path.realpath(v["repo"])==r),
      sorted(n for n,w in s.get("worktrees",{}).items() if os.path.realpath(w["repo"])==r))' "$REPO"

OPEN=$(printf '%s\n' "$OUT2" | grep '^I ' | awk '{print $2}' | sort -u)   # open issue numbers, free — already in hand from input 2
git for-each-ref 'refs/remotes/origin/**' --format='%(refname) %(objectname)' \
  | awk '{n=$1; sub("refs/remotes/origin/","",n); print n, $2}' \
  | grep -vE '^(HEAD|<trunk>|dependabot/)' > "$GITDIR/.triage-branches.tmp"
MATCHED=""
while read -r NAME SHA; do
  NUM=$(printf '%s' "$NAME" | grep -oE '[0-9]+$') || continue      # trailing number run — same convention §3 writes, §5.1 reads
  printf '%s\n' "$OPEN" | grep -qx "$NUM" || continue               # only branches carrying an OPEN issue number
  AHEAD=0
  [ "$(git rev-list --count "origin/<trunk>..origin/$NAME")" -gt 0 ] && AHEAD=1
  MATCHED="$MATCHED
B $NAME $AHEAD"
done < "$GITDIR/.triage-branches.tmp"
TOTALREFS=$(wc -l < "$GITDIR/.triage-branches.tmp" | tr -d ' ')
MATCHEDCOUNT=$(printf '%s\n' "$MATCHED" | grep -c '^B ')
echo "B5 $TOTALREFS $MATCHEDCOUNT"                                 # ← the read's own receipt — empty match is a legitimate state, not a failed one
printf '%s\n' "$(printf '%s\n' "$MATCHED" | grep '^B ' | sort)" \
  | shasum -a 256 | cut -c1-16                                     # 5. session-branch digest (local, 0 calls)
rm -f "$GITDIR/.triage-branches.tmp"
```

All five equal to the stored run, **and no pending wake is now met, and trunk is not red
with nobody owning it (both below)** ⇒ **report
`nothing has changed since <ts>`, re-print the stored conclusion (§0.1), and stop.** Three
calls instead of fifty. Input 2 is not an extra cost on a run that *does* proceed — §1
needs that list anyway.
