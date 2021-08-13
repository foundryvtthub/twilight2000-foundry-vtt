import { getDieSize, T2KRoller } from '../dice.js';
import { T2K4E } from '../config.js';
import Modifier from '../modifier.js';
import { YearZeroRoll } from '../../lib/yzur.js';

/**
 * Twilight 2000 Actor.
 * @extends {Actor} Extends the basic Actor.
 */
export default class ActorT2K extends Actor {

  /* ------------------------------------------- */
  /*  Properties                                 */
  /* ------------------------------------------- */

  get inCombat() {
    return game.combat?.combatants?.some(c => c.actor.id === this.id);
  }

  get hasReliability() {
    return !!this.data.data.reliability?.max;
  }

  get cover() {
    if (this.effects.some(e => e.getFlag('cover', 'statusId') === 'fullCover')) return 'fullCover';
    if (this.effects.some(e => e.getFlag('cover', 'statusId') === 'partialCover')) return 'partialCover';
    return 0;
  }

  /* ------------------------------------------- */
  /*  Data Preparation                           */
  /* ------------------------------------------- */

  /**
   * Augments the basic Actor data model with additional dynamic data.
   * @override
   */
  prepareData() {
    super.prepareData();
    const actorData = this.data;

    // Makes separate methods for each Actor type (character, npc, etc.) to keep
    // things organized.
    switch (actorData.type) {
      case 'character': this._prepareCharacterData(actorData); break;
      case 'npc': this._prepareNpcData(actorData); break;
      case 'vehicle': this._prepareVehicleData(actorData); break;
      case 'unit': this._prepareUnitData(actorData); break;
      default: throw new TypeError(`t2k4e | Unknown Actor Type: "${actorData.type}"`);
    }

    // console.log('t2k4e | Updated Actor: ', this.name, this.id);
  }

  /** @override */
  get itemTypes() {
    if (this.type === 'vehicle') {
      const types = Object.fromEntries(game.system.entityTypes.Item.map(t => [t, []]));
      for (const i of this.items.values()) {
        // Excludes mounted weapons from the vehicle's cargo.
        if (i.data.data.isMounted) continue;
        types[i.data.type].push(i);
      }
      return types;
    }
    return super.itemTypes;
  }

  /* ------------------------------------------- */
  /*  Data Preparation                           */
  /*   → Character & NPC                         */
  /* ------------------------------------------- */

  /**
   * Prepares Character type specific data.
   * @param {Object} actorData The Actor's data
   * @private
   */
  _prepareCharacterData(actorData) {
    const data = actorData.data;

    // Gets the attributes and skills values from their scores.
    this._prepareScores(data.attributes);
    this._prepareScores(data.skills);
    if (data.cuf) this._prepareScores(data.cuf);
    if (data.unitMorale) this._prepareScores(data.unitMorale);

    this._prepareCapacities(data);
    this._prepareEncumbrance(data, actorData.items);
    this._prepareArmorRating(data, actorData.items.filter(i => i.type === 'armor'));
  }

  /* ------------------------------------------- */

  /**
   * Prepares NPC type specific data.
   * @param {Object} actorData The Actor's data
   * @private
   */
  _prepareNpcData(actorData) {
    this._prepareCharacterData(actorData);
  }

  /* ------------------------------------------- */

  /**
   * Adds a `value` property for the die's size equal to its score.
   * @param {Object} obj data.attributes OR data.skills OR any object with a "score" property
   * @private
   */
  _prepareScores(obj) {
    if ('score' in obj) {
      obj.value = getDieSize(obj.score);
    }
    else {
      for (const [, o] of Object.entries(obj)) {
        o.value = getDieSize(o.score);
      }
    }
    // if ('maxScore' in obj) {
    //   obj.max = getDieSize(obj.maxScore);
    // }
  }

  /* ------------------------------------------- */

  /**
   * Adds Hit & Stress Capacities properties to the Actor.
   * Adds also a Health property (with value and max) for token bars.
   * @param {Object} data The Actor's data.data
   * @private
   */
  _prepareCapacities(data) {
    // Capacities are done like this because we want a Health bar for tokens.
    // Only `.value` & `.modifier` should be modified in the Actor's sheet.
    data.health.max = this._getHitCapacity(data) + data.health.modifier;
    data.health.trauma = Math.max(0, data.health.max - data.health.value);
    data.hitCapacity = data.health.max;
    data.damage = data.health.trauma;

    data.sanity.max = this._getStressCapacity(data) + data.sanity.modifier;
    data.sanity.trauma = Math.max(0, data.sanity.max - data.sanity.value);
    data.stressCapacity = data.sanity.max;
    data.stress = data.sanity.trauma;
    return data;
  }

  /* ------------------------------------------- */

  /**
   * Calculates the Hit Capacity.
   * @param {Object} data The Actor's data.data
   * @returns {number}
   * @private
   */
  _getHitCapacity(data) {
    const str = data.attributes.str.value;
    const agl = data.attributes.agl.value;
    return Math.ceil((str + agl) / 4);
  }

  /* ------------------------------------------- */

  /**
   * Calculates the Stress Capacity.
   * @param {Object} data The Actors's data.data
   * @returns {number}
   * @private
   */
  _getStressCapacity(data) {
    const int = data.attributes.int.value;
    const emp = data.attributes.emp.value;
    return Math.ceil((int + emp) / 4);
  }

  /* ------------------------------------------- */

  /**
   * Adds Emcumbrance properties to the Actor.
   * @param {Object} data   The Actor's data.data
   * @param {Item[]} items  Array of items
   * @private
   */
  _prepareEncumbrance(data, items) {
    // Computes the Encumbrance.
    const val1 = (items
      .filter(i => !i.data.data.backpack && i.type !== 'specialty')
      .reduce((sum, i) => {
        if (i.type === 'weapon' && i.hasAmmo && !i.data.data.props?.ammoBelt) {
          const ammoId = i.data.data.mag.target;
          const ammo = this.items.get(ammoId);
          if (ammo && ammo.type === 'ammunition') sum -= ammo.data.data.encumbrance;
        }
        return sum + i.data.data.encumbrance;
      }, 0)
    ) ?? 0;

    data.encumbrance = {
      value: val1,
      max: data.attributes.str.value,
      pct: Math.clamped((val1 / data.attributes.str.value) * 100, 0, 100),
      encumbered: val1 > data.attributes.str.value,
    };

    // Computes the Backpack.
    const val2 = (items
      .filter(i => i.data.data.backpack && i.type !== 'specialty')
      .reduce((sum, i) => {
        if (i.type === 'weapon' && i.hasAmmo && !i.data.data.props?.ammoBelt) {
          const ammoId = i.data.data.mag.target;
          const ammo = this.items.get(ammoId);
          if (ammo) sum -= ammo.data.data.encumbrance;
        }
        return sum + i.data.data.encumbrance;
      }, 0)
    ) ?? 0;

    data.encumbrance.backpack = {
      value: val2,
      max: data.attributes.str.value,
      pct: Math.clamped((val2 / data.attributes.str.value) * 100, 0, 100),
      encumbered: val2 > data.attributes.str.value,
    };
    return data;
  }

  /* ------------------------------------------- */

  /**
   * Adds Armor Ratings properties to the Actor.
   * @param {Object} data    The Actor's data.data
   * @param {Item[]} armors  An array containing the Actor's armors
   * @private
   */
  _prepareArmorRating(data, armors) {
    const ratings = armors.reduce((o, i) => {
      if (!i.data.data.equipped) return o;
      for (const [loc, isProtected] of Object.entries(i.data.data.location)) {
        if (!(loc in o)) o[loc] = 0;
        if (isProtected) {
          o[loc] = Math.max(o[loc], i.data.data.rating.value);
        }
      }
      return o;
    }, {});
    data.armorRating = ratings;
    return data;
  }

  /* ------------------------------------------- */
  /*  Data Preparation                           */
  /*   → Vehicle                                 */
  /* ------------------------------------------- */

  /**
   * Prepares Vehicle type specific data.
   * @param {Object} actorData The Actor's data
   * @private
   */
  _prepareVehicleData(actorData) {
    const data = actorData.data;
    this._computeVehicleEncumbrance(data, actorData.items);
  }

  /* ------------------------------------------- */

  /**
   * Adds Emcumbrance properties a vehicle.
   * @param {Object} data   The Actor's data.data
   * @param {Item[]} items  Array of items
   * @private
   */
  _computeVehicleEncumbrance(data, items) {
    let val = (items
      .filter(i => !i.data.data.isMounted && i.type !== 'specialty')
      .reduce((sum, i) => sum + i.data.data.encumbrance, 0)
    ) ?? 0;

    const maxCrewQty = data.crew.qty + data.crew.passengerQty;
    const crewCount = data.crew.occupants.length;
    const emptySeatCount = Math.max(0, maxCrewQty - crewCount);
    const emptySeatWeight = emptySeatCount * T2K4E.vehicle.emptySeatEncumbrance;
    const extraPassengerCount = -Math.min(0, maxCrewQty - crewCount);
    const extraPassengerWeight = extraPassengerCount * T2K4E.vehicle.extraPassengerEncumbrance;

    const max = data.cargo + emptySeatWeight + (data.trailer ? data.cargo : 0);
    val += extraPassengerWeight;

    data.encumbrance = {
      value: val,
      max,
      pct: Math.clamped((val / max) * 100, 0, 100),
      encumbered: val > max,
    };
    return data;
  }

  /* ------------------------------------------- */
  /*  Data Preparation                           */
  /*   → Military Unit                           */
  /* ------------------------------------------- */

  // TODO placeholder
  _prepareUnitData(data) {}

  /* ------------------------------------------- */
  /*  Roll Modifiers                             */
  /* ------------------------------------------- */

  getRollModifiers() {
    const modifiers = [];
    // Iterates over each item owned by the actor.
    for (const i of this.items) {
      // If there are modifiers...
      if (i.hasModifier) {
        // Physical items must be equipped to give their modifier.
        if (i.isPhysical && !i.isEquipped) continue;
        // Iterates over each roll modifier.
        for (const m of Object.values(i.data.data.rollModifiers)) {
          const mod = new Modifier(m.name, m.value, i);
          modifiers.push(mod);
        }
      }
    }
    return modifiers;
  }

  /* ------------------------------------------- */
  /*  Event Handlers                             */
  /* ------------------------------------------- */

  /** @override */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);

    // Adds default parameters to tokens.
    const updateData = {
      'token.displayName': CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
      'token.displayBars': CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
    };
    switch (this.type) {
      case 'character':
        updateData['token.actorLink'] = true;
        updateData['token.disposition'] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        break;
      case 'npc':
        updateData['token.bar2'] = { attribute: '' };
        break;
      case 'vehicle':
        updateData['token.bar1'] = { attribute: 'reliability' };
        break;
      case 'unit':
        updateData['token.displayName'] = CONST.TOKEN_DISPLAY_MODES.ALWAYS;
        break;
    }
    // Adds default character token size.
    if (['character', 'npc'].includes(this.type)) {
      const size = game.settings.get('t2k4e', 'defaultCharTokenSize');
      if (size >= 0.3 && size <= 2) {
        updateData['token.height'] = size;
        updateData['token.width'] = size;
      }
      else {
        console.warn('t2k4e | defaultCharTokenSize settings not between acceptable range.', size);
      }
    }
    // Performs the update.
    this.data.update(updateData);
  }

  /* ------------------------------------------- */
  /*  Vehicle: Crew Management                   */
  /* ------------------------------------------- */

  /**
   * Adds an occupant to the vehicle.
   * @param {string}  crewId              The id of the added actor
   * @param {string}  [position='PASSENGER'] Crew position flag ('PASSENGER', 'DRIVER', 'GUNNER', or 'COMMANDER')
   * @param {boolean} [isExposed=false]   Whether it's an exposed position
   * @returns {VehicleOccupant}
   */
  addVehicleOccupant(crewId, position = 'PASSENGER', isExposed = false) {
    if (this.type !== 'vehicle') return;
    if (!T2K4E.vehicle.crewPositionFlags.includes(position)) {
      throw new TypeError(`t2k4e | addVehicleOccupant | Wrong position flag: ${position}`);
    }
    const data = this.data.data;
    // if (!(data.crew.occupants instanceof Array)) {
    //   data.crew.occupants = [];
    // }
    const occupant = {
      id: crewId,
      position,
      exposed: isExposed,
    };
    // Removes duplicates.
    if (data.crew.occupants.some(o => o.id === crewId)) this.removeVehicleOccupant(crewId);
    // Adds the new occupant.
    data.crew.occupants.push(occupant);
    this.update({ 'data.crew.occupants': data.crew.occupants });
    return occupant;
  }

  /* ------------------------------------------- */

  /**
   * Removes an occupant from the vehicle.
   * @param {string} crewId The id of the occupant to remove
   * @return {VehicleOccupant[]}
   */
  removeVehicleOccupant(crewId) {
    if (this.type !== 'vehicle') return;
    const crew = this.data.data.crew;
    crew.occupants = crew.occupants.filter(o => o.id !== crewId);
    return crew.occupants;
  }

  /* ------------------------------------------- */

  /**
   * Gets a specific occupant in the vehicle.
   * @param {string} crewId The id of the occupant to find
   * @returns {VehicleOccupant|undefined}
   */
  getVehicleOccupant(crewId) {
    if (this.type !== 'vehicle') return;
    return this.data.data.crew.occupants.find(o => o.id === crewId);
  }

  /* ------------------------------------------- */

  /**
   * Gets a collection of crewed actors.
   * @returns {Collection<string, Actor>} [id, actor]
   */
  getCrew() {
    if (this.type !== 'vehicle') return undefined;
    const c = new foundry.utils.Collection();
    for (const o of this.data.data.crew.occupants) {
      c.set(o.id, game.actors.get(o.id));
    }
    return c;
  }

  /* ------------------------------------------- */
  /*  Radiation Roll                             */
  /* ------------------------------------------- */

  /**
   * Rolls a radiation attack for this character.
   * @param {object} options Additional task check options
   * @returns {Promise<import('../../lib/yzur.js').YearZeroRoll|ChatMessage>}
   */
  async rollRadiationAttack(options) {
    if (this.type !== 'character') return;

    const data = this.data.data;
    const rads = data.rads || {};
    const sievert = rads.temporary + rads.permanent;

    if (sievert <= 0) return;

    const rollConfig = foundry.utils.mergeObject({
      title: game.i18n.localize('T2K4E.ActorSheet.RadiationRoll'),
      attribute: data.attributes.str.value,
      skill: data.skills.stamina.value,
      modifier: T2K4E.radiationVirulence - sievert,
    }, options);
    rollConfig.actor = this;

    return T2KRoller.taskCheck(rollConfig);
  }

  /* ------------------------------------------- */
  /*  Combat & Damage                            */
  /* ------------------------------------------- */

  async applyDamage(amount = 0, attackData, sendMessage = true) {
    amount = +amount ?? 0;

    switch (this.type) {
      case 'character':
      case 'npc':
        this.applyDamageToCharacter(amount, attackData, sendMessage);
        break;
      case 'vehicle':
        break;
    }
  }

  /* ------------------------------------------- */

  async applyDamageToCharacter(amount, attackData, sendMessage = true) {
    const data = this.data.data;
    let msg = '';
    // ! let ablated, incapacited;
    let armorModifier = attackData.armorModifier || 0;
    const baseDamage = attackData.damage;

    // 1 — Barrier & Armor
    if (!attackData.location) {
      const locRoll = new YearZeroRoll('1dl');
      await locRoll.roll({ async: true });
      const loc = locRoll.bestHitLocation;
      attackData.location = T2K4E.hitLocs[loc - 1];
    }
    let barrier = attackData.barrier || 0;
    if (!attackData.cover) { barrier = 0; }
    else if (barrier > 0 && attackData.cover === 'partialCover' && ['arms', 'head'].includes(attackData.location)) {
      barrier = 0;
    }
    const armor = this.data.data.armorRatings[attackData.location];
    const armorLevel = barrier + armor + armorModifier;
    const armorPenetrationLimit = armorLevel - 2;
    const penetrated = baseDamage > armorPenetrationLimit;


    barrier.rating = attackData.barrier || 0;
    barrier.level = barrier.rating > 0 ? Math.max(0, barrier.rating + armorModifier) : 0;
    barrier.penetrationLimit = barrier.level - 2;
    barrier.penetrated = baseDamage > barrier.penetrationLimit;
    barrier.damage = barrier.penetrated ? barrier.level : amount;
    amount -= barrier.damage;
    barrier.deflected = amount <= 0;

    // 2 — Armor
    // const armor = {};

    // 3 — Armor Reduction
    armor = Math.max(0, armor - armorModifier);

    // 3 — Armor Penetration
    const penetrationLimit = armor - 2;
    deflected = baseDamage <= penetrationLimit ? true : (armor >= amount);

    // 4 — Armor Ablation
    if (deflected) {
      amount = 0;
    }
    else {
      amount -= armor;

      // 4.1 — Checks whether there is ablation.
      if (armored) {
        const ablationRoll = new YearZeroRoll('1d6np');
        await ablationRoll.roll({ async: true });

        if (ablationRoll.total <= 1) {
          // 4.2 — Finds the affected armor;
          const armors = this.items.filter(i => i.type === 'armor' && i.data.data.location[attackData.location]);

          // 4.3 — Takes the highest.
          const armorItem = armors.sort((a, b) => b.data.data.rating.value - a.data.data.rating.value)[0];

          // 4.4 — Decreases the armor rating.
          if (armorItem) {
            let rating = armorItem.data.data.rating.value;
            rating = Math.max(0, rating - 1);
            armorItem.update({ 'data.rating.value': rating });
            ablated = true;
          }
        }
      }
    }

    // Exits early if no damage is dealt.
    if (amount <= 0) return 0;

    // 5 — Damage & Health Change
    const oldVal = data.health.value;
    const newVal = Math.max(0, oldVal - amount);
    const diff = newVal - oldVal;
    incapacited = newVal <= 0;

    await this.update({ 'data.health.value': newVal });

    if (!sendMessage) return diff;

    // Prepares the chat message.
    const template = 'systems/t2k4e/templates/chat/apply-damage-chat.hbs';
    const templateData = {
      armored, deflected, ablated, incapacited,
      amount,
      data: attackData,
      config: T2K4E,
    };
    const chatData = {
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ token: this.token }),
      content: await renderTemplate(template, templateData),
      sound: CONFIG.sounds.notification,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
    };
    ChatMessage.applyRollMode(chatData, game.settings.get('core', 'rollMode'));
    await ChatMessage.create(chatData);

    return diff;
  }

  /* ------------------------------------------- */

  /* ------------------------------------------- */
  /*  Chat Card Actions                          */
  /* ------------------------------------------- */

  static chatListeners(html) {}
}

/* ------------------------------------------- */

/**
 * @typedef {object} VehicleOccupant
 * An object defining an occupant of a vehicle.
 * @property {string}  id       The id of the actor
 * @property {string}  position Its position in the vehicle
 * @property {boolean} exposed  Whether it's an exposed position
 * @property {Actor?}  actor    A shortcut to the actor
 */