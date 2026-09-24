"""THE REWARDS FOLLOW THE SUPER SEASON VALUE PICK (2026-09-24).

    python scripts/cardgen/syncRewardsToSuperSeasons.py            # report only
    python scripts/cardgen/syncRewardsToSuperSeasons.py --apply    # rewrite the configs

Run after the Super Season generators and BEFORE the reward generators. Two
moves, both by precedent:

  1. A BUILT reward whose season is now the player's Super Season (Giannis
     2019-20 for the full set, Embiid 2022-23 for the East, Catchings 2012 for
     Indiana) would print the same season twice. It MIGRATES from the Super
     Season instead — the reward wears the gold, the set loses the card, as
     John Wall's Washington reward does (2026-09-18).
  2. A reward that MIGRATES from a Super Season id whose season moved would
     silently follow the id to the new season. It re-points to the retired
     Throwback of its own season (`<id>_<season>`), as David Robinson's Spurs
     reward did (2026-09-22) — the reward keeps what it was.

Both keep the reward's goal and any bandException, and say why in `_comment`.
Configs keep their indent (2), line endings and key order.
"""
import json
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
DATA = os.path.join(ROOT, 'card-data')
GEN = os.path.join(DATA, 'generated')
APPLY = '--apply' in sys.argv
TODAY = '2026-09-24'


def load_text(p):
    with open(p, 'rb') as f:
        raw = f.read().decode('utf-8')
    return raw, '\r\n' in raw


def save_json(p, d, crlf):
    text = json.dumps(d, indent=2, ensure_ascii=False) + '\n'
    if crlf:
        text = text.replace('\n', '\r\n')
    with open(p, 'wb') as f:
        f.write(text.encode('utf-8'))


def cards(name):
    p = os.path.join(GEN, name)
    if not os.path.exists(p):
        return []
    with open(p, encoding='utf-8') as f:
        body = json.load(f)
    return body.get('cards', []) if isinstance(body, dict) else body


def player_id(name):
    """src/cards/playerId.js playerIdFromName, exactly: strip accents, any run of
    other characters becomes one underscore (De'Anthony -> De_Anthony)."""
    import re
    import unicodedata
    s = ''.join(ch for ch in unicodedata.normalize('NFD', name) if not (0x0300 <= ord(ch) <= 0x036f))
    return re.sub(r'[^A-Za-z0-9]+', '_', s).strip('_')


def main():
    report = []
    leagues = [
        ('team-rewards-2026.json', 'super-season', 'throwbacks', 'cards-team-rewards.json'),
        ('wnba-team-rewards-2026.json', 'wnba-super-season', 'wnba-throwbacks', 'cards-wnba-team-rewards.json'),
    ]
    retired_ids = {c['id'] for f in ('demoted-super-seasons.json', 'demoted-wnba-super-seasons.json') for c in cards(f)}
    for config, ss_set, tb_set, reward_file in leagues:
        path = os.path.join(DATA, config)
        raw, crlf = load_text(path)
        cfg = json.loads(raw)
        ss = {c['id']: c for c in cards(f'cards-{ss_set}.json')}
        shipped_rewards = {c['id']: c for c in cards(reward_file)}
        changed = False
        # 1. built rewards (picks, tiers) whose season is the Super Season now
        for section in ('picks', 'tiers'):
            for key, pick in list((cfg.get(section) or {}).items()):
                if not isinstance(pick, dict) or pick.get('set') or not pick.get('name'):
                    continue
                pid = player_id(pick['name'])
                card = ss.get(pid)
                if not card or card.get('season') != pick.get('season'):
                    continue
                entry = {'set': ss_set, 'id': pid, 'goal': pick.get('goal') or key}
                if pick.get('bandException'):
                    entry['bandException'] = pick['bandException']
                entry['_comment'] = (
                    f"{TODAY}: the Super Season value pick made {pick['name']}'s {pick['season']} his/her Super Season, "
                    'so the reward migrates from it and wears the gold (the John Wall precedent) rather than '
                    'printing the same season twice. Was a built pick.'
                    + (f" Note kept: {pick['note']}" if pick.get('note') else '')
                )
                report.append(f'  {config} {section}.{key}: {pick["name"]} {pick["season"]} -> migrates from {ss_set}:{pid}')
                if section == 'picks':
                    # A franchise's move lives in `migrated`, which both leagues' reward generators read.
                    del cfg['picks'][key]
                    cfg.setdefault('migrated', {})[key] = entry
                else:
                    cfg[section][key] = entry
                changed = True
        # 2. rewards migrating from a Super Season id whose season moved
        for key, move in list((cfg.get('migrated') or {}).items()):
            if not isinstance(move, dict) or move.get('set') != ss_set:
                continue
            sid = move['id']
            reward = shipped_rewards.get(sid)
            card = ss.get(sid)
            if not reward or not card or reward.get('season') == card.get('season'):
                continue
            tb_id = f"{sid}_{reward['season']}"
            if tb_id not in retired_ids:
                report.append(f'  ⚠ {config} migrated.{key}: {sid} moved {reward["season"]} -> {card["season"]} '
                              f'but no retired Throwback {tb_id} exists — left alone, check by hand')
                continue
            entry = dict(move)
            entry['set'] = tb_set
            entry['id'] = tb_id
            entry['_comment'] = (
                f"{TODAY}: the Super Season value pick moved {sid}'s Super Season to {card['season']}; this reward "
                f"keeps its {reward['season']} season by migrating from the retired Throwback (the David Robinson "
                f"precedent). Alias the old key {reward_file.replace('cards-', '').replace('.json', '')}:{sid} -> "
                f"...:{tb_id} in cardSets.js KEY_ALIASES."
                + (f" Was: {move['_comment']}" if move.get('_comment') else '')
            )
            report.append(f'  {config} migrated.{key}: {sid} {reward["season"]} -> {tb_set}:{tb_id} (needs a KEY_ALIASES entry)')
            cfg['migrated'][key] = entry
            changed = True
            # The reward's own photo and crop follow its new id, as David
            # Robinson's did — migrateRewardArt only fills an EMPTY slot, so
            # without this the reward would take the Throwback's photo instead.
            reward_set = reward_file.replace('cards-', '').replace('.json', '')
            art = os.path.join(ROOT, 'card-art', 'sets', reward_set)
            for name in os.listdir(os.path.join(art, 'photos')) if os.path.isdir(os.path.join(art, 'photos')) else []:
                stem, ext = os.path.splitext(name)
                if stem == sid:
                    report.append(f'    photo {reward_set}/{name} -> {tb_id}{ext}')
                    if APPLY:
                        os.rename(os.path.join(art, 'photos', name), os.path.join(art, 'photos', tb_id + ext))
            crops_path = os.path.join(art, 'crops.json')
            if os.path.exists(crops_path):
                craw, ccrlf = load_text(crops_path)
                crops = json.loads(craw)
                if sid in crops and tb_id not in crops:
                    report.append(f'    crop  {reward_set}/{sid} -> {tb_id}')
                    if APPLY:
                        crops[tb_id] = crops.pop(sid)
                        save_json(crops_path, crops, ccrlf)
        if changed and APPLY:
            save_json(path, cfg, crlf)
    # 3. set rewards: report a capstone whose source season moved
    for c in cards('cards-set-rewards.json') + cards('cards-wnba-set-rewards.json'):
        src = c.get('migratedFrom') or {}
        if src.get('set') not in ('super-season', 'wnba-super-season'):
            continue
        now = {x['id']: x for x in cards(f"cards-{src['set']}.json")}.get(src['id'])
        if now and now.get('season') != c.get('season'):
            report.append(f"  ⚠ set reward {c['id']} ({c.get('season')}) sources {src['set']}:{src['id']}, now {now.get('season')} — check the group")
    print('\n'.join(report) or '  nothing to sync')
    if not APPLY:
        print('\n(report only — run with --apply to write)')


if __name__ == '__main__':
    main()
