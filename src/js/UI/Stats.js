import { TYPES } from '../core/global.js';
import { game } from '../core/Game.js';
import { gameEvents, EVENTS } from '../core/GameEvents.js';
import { common } from '../core/common.js';
import { gamePrefs } from './preferences.js';
import { net } from '../core/network.js';
import { canNotify } from '../core/logic.js';

const UNKNOWN_VERB = 'UNKNOWN_VERB';

const TEAMS = {
  left: 'leftTeam',
  right: 'rightTeam'
};

function Stats() {
  let data, exports;

  const emoji = {
    banana: '🍌',
    balloon: '🎈',
    bomb: '💣',
    chicken: '🐓',
    flame: '🔥',
    helicopter: '🚁',
    skull: '<span class="no-emoji-substitution">☠️</span>',
    missile: '🚀',
    default: '💥'
  };

  // tracking for "GOURANGA!"
  const youKilledTypes = {
    [TYPES.missileLauncher]: true,
    [TYPES.tank]: true,
    [TYPES.van]: true,
    [TYPES.infantry]: true,
    [TYPES.engineer]: true,
    // extra types which don't have a cost, but do have "value"
    [TYPES.balloon]: true,
    [TYPES.bunker]: true,
    [TYPES.helicopter]: true,
    [TYPES.turret]: true,
    [TYPES.smartMissile]: true
  };

  function statsStructure() {
    return {
      'bullet': 0,
      'balloon': 0,
      'bunker': 0,
      'missile-launcher': 0,
      'gunfire': 0,
      'tank': 0,
      'van': 0,
      'infantry': 0,
      'engineer': 0,
      'helicopter': 0,
      'smart-missile': 0,
      'bomb': 0,
      'turret': 0
    };
  }

  function getTeamDataByPlayer(player) {
    let playerIsEnemy = !!player?.data?.isEnemy;
    let teamData = {
      us: playerIsEnemy ? data[TEAMS.right] : data[TEAMS.left],
      them: playerIsEnemy ? data[TEAMS.left] : data[TEAMS.right]
    }
    return teamData;
  }

  function normalizeObj(obj) {
    if (obj && !obj.data && obj.oParent) {
      obj = obj.oParent;
    }
    return obj;
  }

  function normalizeType(obj) {
    let type = obj.data.type;
    // special case: infantry -> engineer
    if (obj.data.type === TYPES.infantry && obj.data.role) {
      type = TYPES.engineer;
    }
    return type;
  }

  function create(obj) {
    // exclude during level previews, and battle-over destruction sequences
    if (!game.data.started || game.data.battleOver) return;

    // ignore radar items.
    if (obj.data.type === 'radar-item') return;

    let dataObj, type;

    obj = normalizeObj(obj);
    type = normalizeType(obj);

    dataObj = data[obj.data.isEnemy ? TEAMS.right : TEAMS.left].created;

    if (dataObj[type] !== undefined) {
      dataObj[type]++;
    }
  }

  function destroy(obj, options) {
    // exclude during level previews, and battle-over destruction sequences
    if (!game.data.started || game.data.battleOver) return;

    // ignore radar items.
    if (obj.data.type === 'radar-item') return;

    // there might be no data, so go up the chain.

    let dataObj, type;

    // most objects have oParent, except vans which are "hidden" from radar.
    obj = normalizeObj(obj.oParent || obj);

    type = normalizeType(obj);

    // notify when something was destroyed, if not a "silent" death
    if (!options?.silent) maybeNotify(type, obj);

    // note when player destroys MTVIE
    if (
      obj.data.isEnemy &&
      obj?.data?.attacker?.data?.parentType === TYPES.helicopter &&
      youKilledTypes[type]
    ) {
      gameEvents.fire(EVENTS.youKilledSomething, 'type', type);
    }

    // increment the relevant stat
    dataObj = data[obj.data.isEnemy ? TEAMS.right : TEAMS.left].destroyed;

    if (dataObj[type] !== undefined) {
      dataObj[type]++;
    }
  }

  function recycle(obj, options) {
    // exclude during level previews, and battle-over destruction sequences
    if (!game.data.started || game.data.battleOver) return;

    // ignore radar items.
    if (obj.data.type === 'radar-item') return;

    // there might be no data, so go up the chain.

    let dataObj, type;

    // most objects have oParent, except vans which are "hidden" from radar.
    obj = normalizeObj(obj.oParent || obj);

    type = normalizeType(obj);

    // increment the relevant stat
    dataObj = data[obj.data.isEnemy ? TEAMS.right : TEAMS.left].recycled;

    if (dataObj[type] !== undefined) {
      dataObj[type]++;
    }
  }

  const aimedMissile = {
    // special case: smart missiles are the "attacker" only when hostile.
    'hostilePrefix': 'a hostile ',
    // exclude: true,
    'verb': 'smoked',
    'verb_bunker': 'destroyed',
    'verb_infantry': 'toasted',
    'verb_engineer': 'toasted',
    'verb_parachute-infantry': 'walloped',
    'verb_van': 'vaporized',
    'verb_aimed-missile': 'neutralized',
    'verb_smart-missile': 'took out',
    'verb_super-bunker': 'hit'
  };

  /**
   * by type, behaviours for notifications when units are destroyed including
   * icon type (death vs. explosion) and language / notification options
   */
  const notifyTypes = {
    // consider both aimed + napalm as the same for notifications
    'aimed-missile': aimedMissile,
    'missile-napalm': aimedMissile,
    'chain': {
      verb: 'hit'
    },
    // special case: missile launchers can destroy things, or be destroyed by an infantry or tank.
    // they typically die with silent: true, when self-destructing in order to launch a missile.
    'missile-launcher': true,
    'tank': {
      'verb': 'destroyed',
      'verb_engineer': 'steamrolled',
      'verb_infantry': 'steamrolled',
      // hackish: ignore when a tank "hits" a smart missile
      'verb_smart-missile': UNKNOWN_VERB,
      'emoji': emoji.default
    },
    'van': true,
    'flame': {
      verb: 'roasted',
      emoji: emoji.flame
    },
    'infantry': {
      'emoji': emoji.skull,
      'isAn': true,
      'verb': 'shot',
      // hackish: ignore when an infantry "shoots" a smart missile
      'verb_smart-missile': UNKNOWN_VERB
    },
    'parachute-infantry': {
      emoji: emoji.skull
    },
    'engineer': {
      'emoji': emoji.skull,
      'isAn': true,
      'verb': 'shot',
      // hackish: ignore when an engineer "shoots" a smart missile
      'verb_smart-missile': UNKNOWN_VERB
    },
    'balloon': true,
    'bunker': {
      exclude: true
    },
    'helicopter': {
      emoji: emoji.skull,
      verb: 'hit'
    },
    'bomb': {
      offScreenOnly: true,
      verb: 'bombed',
      verb_infantry: 'nuked',
      verb_engineer: 'annihilated',
      emoji: emoji.bomb
    },
    'gunfire': {
      'exclude': true,
      'verb': 'shot',
      'verb_balloon': 'popped',
      'verb_bunker': 'blew out',
      'verb_helicopter': 'toasted',
      'verb_infantry': 'killed',
      'verb_engineer': 'killed',
      'verb_smart-missile': 'shot down',
      'verb_tank': 'took out'
    },
    'shrapnel': {
      exclude: true,
      verb: 'killed',
      verb_balloon: 'popped'
    },
    'smart-missile': {
      // special case: smart missiles are the "attacker" only when hostile.
      'hostilePrefix': 'a hostile ',
      // exclude: true,
      'verb': 'smoked',
      'verb_bunker': 'destroyed',
      'verb_infantry': 'killed',
      'verb_engineer': 'killed',
      'verb_parachute-infantry': 'eviscerated',
      'verb_van': 'trashed',
      'verb_smart-missile': 'took out'
    },
    'super-bunker': {
      'verb': 'shot',
      // hackish: ignore when a super bunker "shoots" a smart missile
      'verb_smart-missile': UNKNOWN_VERB,
      'emoji': emoji.default
    }
  };

  function formatForDisplay(type, item) {
    // hackish: fixes for display to user
    type = type.replace('missileLauncher', emoji.missileLauncher);
    type = type.replace('smartMissile', emoji.missile);

    // e.g., parachute-infantry
    type = type.replace('-', ' ');

    // special missile check: handle variant types, too. ;)
    if (item.data.type === TYPES.smartMissile) {
      const str = 'smart missile';
      if (item.data.isBanana) {
        type = type.replace(str, emoji.banana);
      } else if (item.data.isRubberChicken) {
        type = type.replace(str, emoji.chicken);
      } else {
        type = type.replace(str, emoji.missile);
      }
    } else if (emoji[item.data.type]) {
      // generic text-to-emoji match
      type = type.replace(item.data.type, emoji[item.data.type]);
    }

    return type;
  }

  function getNormalizedUnitName(item) {
    if (!item || !item.data) return;

    // special case: shrapnel and other hostile items can be "from" a helicopter, but ignore the parent type - we want shrapnel.
    if (item.data.hostile) return formatForDisplay(item.data.type, item);

    // some objects have `parentType`, e.g., gunfire fired from a tank. by default, we check for that.
    // then, account for infantry which are actually engineers.
    let type = item.data.type;

    // special case: engineers are infantry, with a role assigned.
    if (type === TYPES.infantry && item.data.role) {
      type = TYPES.engineer;
    }

    // special case: if we have a smart missile, don't go up the chain to the missile launcher.
    // otherwise, check the parent and then handle the infantry/engineer case.
    if (type !== TYPES.smartMissile) {
      type = item.data.parentType || normalizeType(item);
    }

    return formatForDisplay(type, item);
  }

  function getHelicopterLabel(helicopter) {
    if (!helicopter?.data) return;

    const { data } = helicopter;

    const localIsEnemy = game.players.local.data.isEnemy;

    if (net.active && data.isRemote && !data.isCPU) {
      let name = gamePrefs.net_remote_player_name;

      // ignore if the default
      if (name === 'guest' || name === 'host') {
        return data.isEnemy === localIsEnemy ? 'your friend' : 'your opponent';
      }

      // e.g., 'The Old Tanker'
      return gamePrefs.net_remote_player_name;
    }

    if (data.isEnemy === game.players.local.data.isEnemy) {
      // yourself, or your friend in humans_vs_cpu[s]?
      if (data.id === game.players.local.data.id) return `you`;
      return `a friendly helicopter`;
    } else {
      if (!net.active) return `the enemy helicopter`;
      // generic
      return `an enemy ${helicopter}`;
    }
  }

  function getNormalizedAttackerString(attacker) {
    // common string building: "somebody did something."

    const normalizedType = getNormalizedUnitName(attacker);

    const aData = attacker.data;

    // this shouldn't happen.
    if (!normalizedType || !aData) return 'an unknown unit';

    // special case: return hostile objects (shrapnel, expired missiles) as-is.
    if (aData.hostile)
      return (notifyTypes[aData.type]?.hostilePrefix || '') + normalizedType;

    // treat helicopters as the actor for gunfire, and bombs (e.g., "you bombed a tank") - but not smart missiles, nor shrapnel - e.g., when you died.
    const isHelicopter =
      (aData?.parentType === TYPES.helicopter ||
        aData.type === TYPES.helicopter) &&
      aData.type !== TYPES.shrapnel &&
      aData.type !== TYPES.smartMissile;

    // build out string, based on enemy/non-enemy, local vs. remote player.
    if (isHelicopter) {
      return getHelicopterLabel(
        aData?.parentType === TYPES.helicopter ? aData.parent : attacker
      );
    }

    // enemy case, e.g., "an enemy tank"
    if (aData.isEnemy !== game.players.local.data.isEnemy)
      return `an enemy ${normalizedType}`;

    // everything else: "your infantry"
    return `your ${normalizedType}`;
  }

  function maybeNotify(type, target) {
    // notify when a game object is being destroyed, given a target died (subject to the type.)
    // e.g., target is a tank object, and its `data.attacker` is the unit or munition which took out the target.
    if (!type || !target) return;

    return common.setFrameTimeout(() => maybeNotifyRAF(type, target), 16);
  }

  function maybeNotifyRAF(type, target) {
    // notify when a game object is being destroyed, given a target died (subject to the type.)
    // e.g., target is a tank object, and its `data.attacker` is the unit or munition which took out the target.
    if (!type || !target) return;

    const notifyItem = notifyTypes[type];

    // lots of types, e.g., gunfire and bombs, can be ignored when they die.
    if (!notifyItem || notifyItem.exclude) return;

    // special case: paratroopers hit the ground, the parachute didn't open in time.
    if (target.data.didHitGround) {
      if (gamePrefs[`notify_${data.type}`]) {
        game.objects.notifications.add(
          `${
            target.data.isEnemy !== game.players.local.data.isEnemy
              ? 'An enemy'
              : 'Your'
          } infantry’s parachute failed to open. ${emoji.skull}`
        );
      }
      return;
    }

    // the object responsible for killing the target
    let attacker = target.data?.attacker?.data;

    // this should not be common, save for a few units - e.g., a missile launcher that is self-destructing.
    if (!attacker) return;

    // certain targets can be ignored, too. i.e., bunkers don't kill missiles.
    if (notifyTypes[attacker.type]?.exclude) {
      // what about the parent - e.g., is this gunfire from an infantry?
      // don't notify if the parent is a helicopter, though - we have those covered separately.
      if (
        attacker.parent &&
        attacker.parent.data.type !== TYPES.helicopter &&
        attacker.parent.data.type !== TYPES.turret &&
        notifyTypes[attacker.parent.data.type] &&
        !notifyTypes[attacker.parent.data.type].exclude
      ) {
        attacker = attacker.parent.data;
      } else if (
        // special case: allow "raw" off-screen shrapnel that kills stuff to be reported.
        !(attacker.type === TYPES.shrapnel && !target.data?.isOnScreen)
      ) {
        return;
      }
    }

    // vans may explode with an invisible "bomb" that can kill infantry, but don't report them.
    if (attacker.type === TYPES.van) return;

    // user might have turned off notifications for these types
    if (!canNotify(type, attacker.type)) return;

    // certain things can be ignored if in view, i.e., you bomb an on-screen tank.
    // if you throw a bomb off-screen and it hits something, then it makes sense to notify.
    if (target.data.isOnScreen && notifyTypes[attacker.type]?.offScreenOnly)
      return;

    // did a helicopter die?
    const isHelicopter = type === TYPES.helicopter;

    // action word based on attacker type; e.g., gunfire = "shot", bomb = "bombed" etc.
    // allow for object-specific interactions also, e.g., gunfire hitting a balloon -> `gunfire = { balloon_verb: 'popped' }`
    const attackerItem = notifyTypes[attacker.type] || {};

    const verb =
      attackerItem[`verb_${type}`] || attackerItem.verb || UNKNOWN_VERB;

    if (verb === UNKNOWN_VERB) {
      console.warn(
        `${UNKNOWN_VERB} for type / target`,
        type,
        target.data,
        attacker?.type,
        attacker,
        attackerItem
      );
      return;
    }

    // special case: handle when types match, e.g., "their infantry shot one of yours"
    // the attacker may be the gunfire of a tank, so check the parent as well.
    // smart missiles can launch from either helicopters or missile launchers, so don't presume they're the same.
    let isSameType;

    // check the parent, if it's gunfire.
    // e.g., player helicopter's gunfire hitting the CPU helicopter.
    if (attacker.type === TYPES.gunfire) {
      isSameType = attacker.parentType === type;
    } else {
      // perhaps two missiles, etc., took each other out.
      isSameType = attacker.type === type;

      // check for helicopter collision - with other helicopter, or a building or ground unit.
      if (isHelicopter) {
        // extra-special case: player + CPU helicopters collided.
        if (attacker.type === TYPES.helicopter) {
          game.objects.notifications.add(
            `You collided with the enemy. ${emoji.skull}${emoji.skull}`
          );
          return;
        }

        // helicopter hit something that was not another helicopter.
        // if the helicopter collided with a non-munition - i.e., ground unit or building - bail.
        // this avoids a duplicate notification, e.g., "a balloon hit a helicopter."
        if (
          attacker.type !== TYPES.smartMissile &&
          attacker.type !== TYPES.bomb &&
          attacker.type !== TYPES.chain
        )
          return;
      }
    }

    // special case: "your opponent hit a smart missile", just ignore.
    // the reverse is covered, e.g., "you were smoked by an enemy smart missile."
    if (
      target.data.type === TYPES.smartMissile &&
      attacker.type === TYPES.helicopter
    )
      return;

    // if (e.g.) two tanks fought, determine who won. "your" or "their" (attacking) tank "took out one of theirs / yours."
    let didYoursWin = isSameType && !attacker.isEnemy;

    // if two tanks, ignore becuse tanks handle that themselves.
    if (isSameType && type === TYPES.tank) return;

    let text;
    let youWonText = 'an enemy';
    let theyWonText = 'your';

    // special case: when player's helicopter dies, use special verbiage. "You (were) X by a Y"
    if (
      !isSameType &&
      isHelicopter &&
      target.data.id === game.players.local.data.id
    ) {
      // hacks
      if (attacker.type === TYPES.chain) {
        text = `You ${verb} ${getNormalizedAttackerString(
          target.data.attacker
        )}`;
      } else {
        text = `You were ${verb} by ${getNormalizedAttackerString(
          target.data.attacker
        )}`;
      }
    } else if (isHelicopter) {
      // one helicopter shot down the other.
      youWonText = 'the enemy helicopter';
      theyWonText = 'you';
    }

    // if not already set via special case, assign now.
    if (!text) {
      // "something" [shot/bombed/killed] [one of yours|an|a] "something", including same-type and hostile-killed-[enemy|friendly] cases
      text = `${getNormalizedAttackerString(target.data.attacker)} ${verb} ${
        isSameType
          ? didYoursWin
            ? youWonText
            : theyWonText
          : (attacker.hostile
              ? target.data.isEnemy
                ? 'an enemy '
                : 'your '
              : notifyItem.isAn
                ? 'an '
                : 'a ') + getNormalizedUnitName(target)
      }`;

      /**
       * Hacks to fix edge cases...
       * e.g., "your van nuked an infantry" - some units explode as a bomb, which can kill nearby / overlapping units.
       * "nuke" is the key verb for bombs.
       * Bunkers can also mistakenly "bomb" tanks.
       */
      text = text.replace(
        /bunker (bombed|annihilated)/g,
        'bunker exploded, killing'
      );
      text = text.replace(
        /turret (bombed|annihilated)/g,
        'turret exploded, killing'
      );
      text = text.replace(/van nuked/g, 'van exploded, killing');
      text = text.replace(/tank nuked/g, 'tank exploded, killing');

      text = text.replace('a helicopter', 'the enemy helicopter');
      text = text.replace(
        `a ${emoji.helicopter}`,
        `the enemy ${emoji.helicopter}`
      );

      // HACK: fix cases like `💣 bombed your van 💣`
      // TODO: determine root cause and properly fix. :X
      if (text.charCodeAt(0) === '💣'.charCodeAt(0)) {
        text = text.replace('💣 ', 'the enemy helicopter ');
      }

      // one more emoji search-and-replace.
      text = text.replace('helicopter', emoji.helicopter);

      if (gamePrefs.bnb) {
        text = text.replace(
          'your turret',
          Math.random() >= 0.5 ? 'THE GREAT CORNHOLIO' : 'THE ALMIGHTY BUNGHOLE'
        );
      }
    }

    // take attacker first, then notifyItem?
    const emo = attackerItem?.emoji || notifyItem?.emoji;
    if (emo) {
      text += ` ${emo}`;
    }

    // don't notify if on-screen, *unless* it's the helicopter or gunfire / bombs / smart missiles.
    // TODO: improve target vs. attacker helicopter logic, work onScreen check into notification preferences.
    if (
      target.data.isOnScreen &&
      !isHelicopter &&
      attacker.type !== TYPES.helicopter &&
      attacker?.parentType !== TYPES.helicopter
    )
      return;

    // HACK: one more exception: interaction between two "same" units - e.g., "An enemy infantry shot your <span ...>" - should be "yours", of course.
    if (text.includes('your <')) {
      text = text.replace('your <', 'one of yours <');
    }

    // "go go go", capitalizing the first letter.
    game.objects.notifications.add(
      text.charAt(0).toUpperCase() + text.slice(1)
    );
  }

  function markEnd() {
    data.time.end = new Date();
  }

  function displayEndGameStats() {
    console.log('TODO: fix endgame stats. 😅');
    return;

    /*
    let i, j, k, items, cols, type, offset, dataSource;
    items = document.getElementById('stats-endgame').getElementsByTagName('tr');
    // data sources
    dataSource = [data[TEAMS.left].destroyed, data[TEAMS.right].destroyed];
    offset = 1;
    for (i = 0, j = items.length; i < j; i++) {
      type = items[i].getAttribute('data-type');
      if (type) {
        cols = items[i].getElementsByTagName('td');
        for (k = 0; k < 2; k++) {
          if (cols[k + offset]) {
            cols[k + offset].childNodes[0].textContent = dataSource[k][type];
          }
        }
      }
    }
    document.getElementById('stats-endgame').style.display = 'block';
    */
  }

  data = {
    time: {
      start: new Date(),
      end: null
    },
    [TEAMS.left]: {
      created: statsStructure(),
      destroyed: statsStructure(),
      recycled: statsStructure()
    },
    [TEAMS.right]: {
      created: statsStructure(),
      destroyed: statsStructure(),
      recycled: statsStructure()
    }
  };

  exports = {
    create,
    data,
    destroy,
    displayEndGameStats,
    formatForDisplay,
    getTeamDataByPlayer,
    markEnd,
    recycle
  };

  return exports;
}

export { Stats };
