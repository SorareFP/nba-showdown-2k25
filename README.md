# NBA Showdown 2K25

D20 Basketball Card Game — React App

## First-time setup

1. Install dependencies:
```bash
npm install
```

2. Run locally:
```bash
npm run dev
```
Open http://localhost:5173

## Deploy to GitHub Pages

### One-time setup

1. Create a GitHub repo named `nba-showdown-2k25`

2. In `vite.config.js`, confirm the base path matches your repo name:
```js
base: '/nba-showdown-2k25/',
```

3. In `package.json`, add your GitHub username to the deploy script:
```json
"homepage": "https://SorareFP.github.io/nba-showdown-2k25"
```

4. Initialize git and push:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/SorareFP/nba-showdown-2k25.git
git push -u origin main
```

### Deploy
```bash
npm run deploy
```

This builds the app and pushes to the `gh-pages` branch automatically.
Your game will be live at: `https://SorareFP.github.io/nba-showdown-2k25`

## Project structure

```
src/
  game/
    rawCards.js      # 306 player cards (auto-generated)
    cards.js         # Card data exports + helpers
    strats.js        # Strategy card definitions
    engine.js        # Core game logic (pure functions)
    canPlay.js       # Card playability rules
  components/
    CardsTab.jsx     # Card browser
    StratsTab.jsx    # Strategy card reference
    TeamBuilderTab.jsx
    PlayTab.jsx      # Game controller
    game/
      Scoreboard.jsx
      DraftPhase.jsx
      MatchupPhase.jsx
      ScoringPhase.jsx
      GameLog.jsx
      FatigueLegend.jsx
      GameOver.jsx
```
