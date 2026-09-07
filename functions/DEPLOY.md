# Deploying, step by step

Written for someone who has never deployed a Cloud Function. **Claude cannot do
any of this — it needs credentials, and it should never have them.** Every
command below runs on your machine, signed in as you.

## Before you start

- The app is hosted on **GitHub Pages** (`npm run deploy` → `gh-pages -d dist`).
  Firebase is used only for Auth, Firestore and the Realtime Database. That does
  not change here.
- Firebase project: `nba-showdown-2k25` (from `src/firebase/config.js`).
- You need the **Blaze plan**. See "What this costs" below — the honest answer
  is almost certainly nothing, but it does require a card on the account.

## THE FOLDER. Read this first.

Every Firebase file is on the `feature/card-studio` branch, which lives in the
worktree. **`main` has none of them.** Run everything from here:

```powershell
cd C:\Users\hoops\OneDrive\Documents\showdown-app\showdown-app\.worktrees\card-studio
```

From the repo root you get `firebase use must be run from a Firebase project
directory` and `cd functions` fails, because neither exists there.

The project is already pinned in `.firebaserc`, so there is no `firebase use`
step. And these are PowerShell commands: `;` between them, never `&&` — PowerShell
5.1 rejects `&&` outright.

## One-time setup

```powershell
npm install -g firebase-tools
firebase login                    # opens a browser, signs you in as you
cd functions; npm install; cd ..
```

## Two things already fixed for you

Both would have failed a deploy, and both were found by checking rather than by
running anything against your project.

**The predeploy hook was POSIX-only.** Firebase's documented form is
`node "$RESOURCE_DIR/prepare.mjs"`, and `$RESOURCE_DIR` is shell syntax that
cmd.exe does not expand — on Windows the hook runs that string literally, node
cannot find the module, and step 1 aborts before anything uploads. `firebase.json`
now uses a plain relative path, which is correct on every platform because
firebase-tools runs hooks from the directory holding `firebase.json` and
`prepare.mjs` resolves its own location anyway.

**`firestore.indexes.json` did not exist**, though `firebase.json` pointed at it.
It holds one composite index: the market's `loadListings({ cardKey })` filters on
`cardKey` and sorts by `price`, and Firestore builds single-field indexes on its
own but not that combination. Missing, the query does not come back empty — it
throws `FAILED_PRECONDITION` the first time somebody filters the market by card.

## What changed after the first deploy (2026-09-05)

The first `firebase deploy --only functions` put up three functions that
**nothing in the app called**: the switch in `src/firebase/serverWrites.js` was
exported and read by no component. And reading the rules against the client's
writes found four more value-moving paths with no server version at all —
listing, delisting, burning a spare, and paying out a finished game. Step 4
would have broken all of them.

There are now **seven** functions, every component goes through the switch, the
dev buttons (grant coins, reset account) hide themselves once the switch is on,
and the rules stop a client from resetting its own starter pack or daily coin
cap. So step 1 has to be run again, and step 3 has more to check.

## Step 1 — deploy the functions

```powershell
firebase deploy --only functions
```

Nothing changes for players. The functions exist and nobody calls them; the app
is still writing directly, exactly as it does today. If this fails, it fails
here, with the game untouched.

Expect it to take a few minutes the first time — it enables APIs and builds a
container.

## Step 2 — point the app at them

In `src/firebase/serverWrites.js`:

```js
export const USE_CLOUD_FUNCTIONS = true;
```

Then:

```powershell
npm run deploy      # builds and pushes to GitHub Pages
```

## Step 3 — verify, by hand, as a player

Open the live site and do all three:

1. **Open the starter pack** on a fresh account, or **buy and open a pack**.
   The reveal now happens *after* the save — coins drop first, then the cards
   animate. That is the server rolling the dice.
2. **List a spare, then take it down.** Then **buy a listing** from a second
   account if you have one.
3. **Burn a spare.** Coins should rise by the card's rarity value — you can no
   longer name the price.
4. **Finish a game.** Coins arrive on the results screen; a second win the same
   day should not pay the first-win bonus again.
5. **Claim a finished collection.** The reward card should arrive as `Earned`.
6. The **DEV buttons should be gone** from the collection tab.

If any of them misbehaves: set `USE_CLOUD_FUNCTIONS = false`, `npm run deploy`,
and you are back to today's behaviour. That is the whole reason the direct path
is still in the code.

## Step 4 — close the client's write access

**Only after step 3 passes.**

```powershell
firebase deploy --only firestore:rules
```

This is the step that actually secures anything. It locks the browser out of
`copies`, `supply`, `currency` and `claims` — so if the app is still writing
those directly, every pack open breaks the moment this lands. That is why it is
last.

## What this costs

Two free tiers apply, and this game sits inside both.

**Cloud Functions (2nd gen), per month:** 2,000,000 invocations, 400,000
GB-seconds, 200,000 GHz-seconds, 5 GB egress.
**Firestore, per day:** 50,000 reads, 20,000 writes, 1 GiB stored.

One pack open costs roughly **1 invocation, ~8 reads and ~12 writes** (five
copies, five collection index entries, the supply counter, the wallet, a history
row).

| players opening | invocations/month | writes/day | cost |
|---|---|---|---|
| 100 packs/day | 3,000 | 1,200 | **$0** |
| 1,000 packs/day | 30,000 | 12,000 | **$0** |
| 10,000 packs/day | 300,000 | 120,000 | ~**$5/month** |

At 10,000 packs a day you are 100,000 writes over the daily free tier, and
Firestore writes are about $0.18 per 100,000. Invocations stay negligible —
300,000 is 15% of the free allowance.

**So: $0 until this game is genuinely popular, then single-digit dollars.**
Prices change; check <https://firebase.google.com/pricing> before trusting these.

### The real risk is a runaway loop, not traffic

A bug that calls a function in a tight loop is how people get surprise bills.
Two guards:

- `MAX_PACKS_PER_MINUTE = 30` in `index.js` caps one account's rate.
- Set a **budget alert** in Google Cloud Billing (Billing → Budgets & alerts) at
  something like $5. **Note it only emails you — it does not hard-stop billing.**
  There is no true spending cap on Firebase; anyone who tells you otherwise is
  thinking of the alert.

## Can you avoid Blaze entirely?

**Not for Cloud Functions.** Deploying any function has required Blaze since
2022. There is no free tier that includes them.

**But you can get part of the way for free**, with security rules alone. Rules
can compare the incoming write to the existing document, so they can refuse:

- any write that *increases* `currency` (kills "give myself a million coins")
- any write to `claims` (kills claiming the same collection repeatedly)
- a `copies` document whose `state` is `earned` (kills minting reward cards)

What rules **cannot** do is roll dice. The pack has to be generated somewhere,
and if that is the browser then a determined player can always claim they rolled
a legendary — the roll is not checkable after the fact, because any legal pack
*could* have come out.

So the free version stops casual coin and reward forgery and leaves pack
generation on the honour system. Whether that is enough depends on who plays.
For a game you and friends play, it is plenty. For anything public, it is not.

Say the word and I will write that rules-only version as a separate file — it is
maybe thirty lines and costs nothing to deploy.
