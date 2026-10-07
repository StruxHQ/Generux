#!/usr/bin/env bash
# The pipeline board is the state: this reads and moves an issue's Status card.
#   board.sh <issue> <Idle|Analysis|Plan review|Build|Acceptation>   move it
#   board.sh <issue> get                                            print its Status
# PROJECT_ID is the board's node id (repo variable PIPELINE_PROJECT_ID). GH_TOKEN
# needs `repo` + `project` (AGENT_PAT). Adding is idempotent, so an issue not yet
# on the board is put there.
set -euo pipefail
issue=$1 status=$2
: "${PROJECT_ID:?set the PIPELINE_PROJECT_ID repository variable}"
content=$(gh issue view "$issue" --repo "$GITHUB_REPOSITORY" --json id --jq .id)
item=$(gh api graphql -f query='mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}' \
  -f p="$PROJECT_ID" -f c="$content" --jq .data.addProjectV2ItemById.item.id)
if [ "$status" = get ]; then
  gh api graphql -f query='query($i:ID!){node(id:$i){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}' \
    -f i="$item" --jq '.data.node.fieldValueByName.name // ""'
  exit 0
fi
read -r field option < <(gh api graphql -f query='query($p:ID!){node(id:$p){... on ProjectV2{field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}' \
  -f p="$PROJECT_ID" --jq ".data.node.field | .id + \" \" + (.options[] | select(.name == \"$status\") | .id)")
[ -n "${option:-}" ] || { echo "::error::No Status option '$status' on the board"; exit 1; }
gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' \
  -f p="$PROJECT_ID" -f i="$item" -f f="$field" -f o="$option" > /dev/null
echo "Issue #$issue -> $status"
