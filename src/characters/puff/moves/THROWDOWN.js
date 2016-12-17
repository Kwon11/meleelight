import {player, characterSelections} from "../../../main/main";
import {actionStates, turnOffHitboxes, randomShout} from "../../../physics/actionStateShortcuts";
import {framesData} from "../../../main/characters";
import puff from "./index";
import {hitQueue} from 'physics/hitDetection';
import WAIT from "../../shared/moves/WAIT";
import CATCHCUT from "../../shared/moves/CATCHCUT";
export default  {
  name: "THROWDOWN",
  canEdgeCancel: false,
  canBeGrabbed: true,
  init: function (p, input) {
    player[p].actionState = "THROWDOWN";
    player[p].timer = 0;
    actionStates[characterSelections[player[p].phys.grabbing]].THROWNPUFFDOWN.init(player[p].phys.grabbing, input);
    const frame = framesData[characterSelections[player[p].phys.grabbing]].THROWNPUFFDOWN;
    player[p].phys.releaseFrame = frame + 1;
    turnOffHitboxes(p);
    player[p].hitboxes.id[0] = player[p].charHitboxes.throwdownextra.id0;
    randomShout(characterSelections[p]);
    puff.THROWDOWN.main(p, input);
  },
  main: function (p, input) {
    player[p].timer += 61 / player[p].phys.releaseFrame;
    if (!puff.THROWDOWN.interrupt(p, input)) {
      //10,23,36,49
      if (player[p].timer < 51) {
        if (player[p].timer % 13 === 10) {
          player[p].hitboxes.active = [true, false, false, false];
          player[p].hitboxes.frame = 0;
        }
        if (player[p].timer % 13 === 11) {
          turnOffHitboxes(p);
        }
      }
      if (Math.floor(player[p].timer + 0.01) === 61) {
        player[p].hitboxes.id[0] = player[p].charHitboxes.throwdown.id0;
        hitQueue.push([player[p].phys.grabbing, p, 0, false, true, true]);
        turnOffHitboxes(p);
      }

    }
  },
  interrupt: function (p, input) {
    if (player[p].timer > 84) {
      player[p].phys.grabbing = -1;
      WAIT.init(p, input);
      return true;
    }
    else if (player[p].timer < player[p].phys.releaseFrame && player[player[p].phys.grabbing].phys.grabbedBy !== p) {
      console.log("test");
      CATCHCUT.init(p, input);
      return true;
    }
    else {
      return false;
    }
  }
};