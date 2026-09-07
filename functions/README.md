# Server-side writes

Three writes create value, and until now all three happened in the browser:

| function | what it creates |
|---|---|
| `openPack` | spends coins and **mints copies** |
| `buyListing` | moves a copy and coins between two players |
| `claimGoal` | pays coins and mints an **earned** copy |

`generatePack` ran client-side and `addCardsToCollection` wrote whatever the
client handed it, so anyone who can open a console could mint a legendary. Under
the supply model that is not just unfair — a fabricated copy changes the pull
rate for **everybody**, because a card gets scarcer as copies enter circulation.

## Nothing here is deployed

**Cloud Functions require the Blaze (pay-as-you-go) plan.** For a game this size
the cost is a rounding error — the free tier covers 2M invocations a month — but
it does mean attaching a card to the project.

**Step-by-step instructions, including costs and whether Blaze can be avoided:
see [DEPLOY.md](DEPLOY.md).**

## Deploy in this order

The order matters. Steps 1–3 get you there with no window where the game is down;
step 4 is the one that actually secures anything.

```bash
# 1. Deploy the functions. Nothing changes yet — nobody calls them.
cd functions && npm install && cd ..
firebase deploy --only functions

# 2. Flip the switch in src/firebase/serverWrites.js
#    export const USE_CLOUD_FUNCTIONS = true;
#    THE APP IS ON GITHUB PAGES, not Firebase Hosting:
npm run deploy

# 3. Verify by hand: open a pack, buy a listing, claim a goal.
#    If anything misbehaves, flip the boolean back and redeploy hosting.

# 4. Close the direct path for good.
firebase deploy --only firestore:rules
```

**Do not do step 4 first.** `firestore.rules` locks the client out of `copies`,
`supply`, `currency` and `claims`. Deployed while the app is still writing those
directly — which it does today — every pack open and every burn fails instantly.

## Why the rules are the real fix

The functions use the Admin SDK, which bypasses security rules entirely. That is
the mechanism: the rules refuse the client, the Admin SDK is not subject to them,
and there is no third party. **Deploying the functions without the rules changes
nothing about what a determined client can do** — it just adds a second, honest
path alongside the forgeable one.

## `shared/` is build output

`prepare.mjs` copies the game modules and card data out of `src/` and
`card-data/generated/` into `functions/shared/`, and the `predeploy` hook in
`firebase.json` runs it on every deploy. Firebase uploads only the `functions`
directory, so `import '../src/game/packEngine.js'` resolves locally, passes every
test, and then throws `MODULE_NOT_FOUND` in production.

`shared/` is gitignored. **`src/` is the source of truth** — if the two ever
disagree, that is a bug, not a fork.

`functions/serverSafe.test.js` guards the thing that breaks silently: a shared
module that reaches `window`, `localStorage` or a React import works fine in the
browser and fails at cold start. It already caught one real bug — `claimGoal`
passing a map of documents where `goalProgress` wanted a `Set`, which would have
thrown for the first player to finish a collection.

## What deliberately stayed on the client

Teams, decks and settings. They arrange cards a player already owns, they create
nothing, and a round trip would make them feel slow for no gain.
