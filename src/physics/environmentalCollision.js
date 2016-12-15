// @flow

import {Vec2D, getXOrYCoord} from "../main/util/Vec2D";
import {Box2D} from "../main/util/Box2D";
import {dotProd, scalarProd, norm, orthogonalProjection} from "../main/linAlg";
import {findSmallestWithin} from "../main/util/findSmallestWithin";
import {solveQuadraticEquation} from "../main/util/solveQuadraticEquation";
import {lineAngle} from "../main/util/lineAngle";
import {extremePoint} from "../stages/util/extremePoint";
import {connectednessFromChains} from "../stages/util/connectednessFromChains";
import {moveECB} from "../main/util/ecbTransform";

//import type {ECB} from "../main/util/ecbTransform";
//import type {ConnectednessFunction} from "../stages/util/connectednessFromChains";
import type {Stage} from "../stages/stage";

// replicated here because of duplicate imports bug
type ConnectednessFunction = (label : [string, number], side : string) => null | [string, number];
type ECB = [Vec2D, Vec2D, Vec2D, Vec2D];


const magicAngle : number = Math.PI/6;
export const additionalOffset : number = 0.00001;

// next ECB point index, counterclockwise or clockwise
function turn(number : number, counterclockwise : boolean = true ) : number {
  if (counterclockwise) {
    if (number === 3) {
      return 0;
    }
    else { 
      return number + 1;
    }
  }
  else {
    if (number === 0) {
      return 3 ;
    }
    else {
      return number - 1;
    }
  }
};

// returns true if the vector is moving into the wall, false otherwise
function movingInto (vec : Vec2D, wallTopOrRight : Vec2D, wallBottomOrLeft : Vec2D, wallType : string) : boolean {
  let sign = 1;
  switch (wallType) {
    case "l": // left wall
    case "g": // ground
    case "b":
    case "d":
    case "p": // platform
      sign = -1;
      break;
    default: // right wall, ceiling
      break;
  }
  // const outwardsWallNormal = new Vec2D ( sign * (wallTopOrRight.y - wallBottomOrLeft.y), sign*( wallBottomOrLeft.x-wallTopOrRight.x )  );
  // return ( dotProd ( vec, outwardsWallNormal ) < 0 );
  return ( dotProd ( vec, new Vec2D ( sign * (wallTopOrRight.y - wallBottomOrLeft.y), sign*(wallBottomOrLeft.x-wallTopOrRight.x) ) ) < 0);
};

// returns true if point is to the right of a "left" wall, or to the left of a "right" wall,
// and false otherwise
function isOutside (point : Vec2D, wallTopOrRight : Vec2D, wallBottomOrLeft : Vec2D, wallType : string) : boolean {
  //const vec = new Vec2D ( point.x - wallBottom.x, point.y - wallBottom.y );
  //return ( !movingInto(vec, wallTop, wallBottom, wallType ) );
  return ( !movingInto( new Vec2D ( point.x - wallBottomOrLeft.x, point.y - wallBottomOrLeft.y ), wallTopOrRight, wallBottomOrLeft, wallType ) );
};

// say line1 passes through the two points p1 = (x1,y1), p2 = (x2,y2)
// and line2 by the two points p3 = (x3,y3) and p4 = (x4,y4)
// this function returns the parameter t, such that p3 + t*(p4-p3) is the intersection point of the two lines
// please ensure this function is not called on parallel lines
function coordinateInterceptParameter (line1 : [Vec2D, Vec2D], line2 : [Vec2D, Vec2D]) : number {
  // const x1 = line1[0].x;
  // const x2 = line1[1].x;
  // const x3 = line2[0].x;
  // const x4 = line2[1].x;
  // const y1 = line1[0].y;
  // const y2 = line1[1].y;
  // const y3 = line2[0].y;
  // const y4 = line2[1].y;
  // const t = ( (x1-x3)*(y2-y1) + (x1-x2)*(y1-y3) ) / ( (x4-x3)*(y2-y1) + (x2-x1)*(y3-y4) );
  // return t;
  return (     (line1[0].x-line2[0].x)*(line1[1].y-line1[0].y) 
             + (line1[0].x-line1[1].x)*(line1[0].y-line2[0].y) ) 
          / (  (line2[1].x-line2[0].x)*(line1[1].y-line1[0].y) 
             + (line1[1].x-line1[0].x)*(line2[0].y-line2[1].y) );
};

// find the intersection of two lines
// please ensure this function is not called on parallel lines
export function coordinateIntercept (line1 : [Vec2D, Vec2D], line2 : [Vec2D, Vec2D]) : Vec2D {
  const t = coordinateInterceptParameter(line1, line2);
  return ( new Vec2D( line2[0].x + t*(line2[1].x - line2[0].x), line2[0].y + t*(line2[1].y - line2[0].y) ) );
};

function pointSweepingCheck ( wall : [Vec2D, Vec2D], wallType : string, wallIndex : number
                            , wallTopOrRight : Vec2D, wallBottomOrLeft : Vec2D
                            , stage : Stage, connectednessFunction : ConnectednessFunction
                            , xOrY : number, position : Vec2D, same
                            , ecb1Same : Vec2D, ecbpSame : Vec2D
                            , ecb1Top  : Vec2D, ecbpTop  : Vec2D ) : null | [null | string, Vec2D, number, number] {

  let relevantECB1Point = ecb1Same;
  let relevantECBpPoint = ecbpSame;

  if (wallType === "l" || wallType === "r") { // left or right wall, might need to check top ECB point instead of same side ECB point for collision
    // determine which of top or same side ECB point is relevant through an angle calculation
    const wallAngle = lineAngle([wallBottomOrLeft, wallTopOrRight]); // bottom to top for walls
    const ecbAngle  = lineAngle([ecbpSame, ecbpTop]); // also bottom to top
    if ( ( wallType === "l" && wallAngle > ecbAngle) || (wallType === "r" && wallAngle < ecbAngle) ) {
      relevantECB1Point = ecb1Top;
      relevantECBpPoint = ecbpTop;
    }
  }

  const s = coordinateInterceptParameter (wall, [relevantECB1Point,relevantECBpPoint]); // need to put wall first
  let angularParameter = same;

  if (s > 1 || s < 0 || isNaN(s) || s === Infinity) {
    console.log("'pointSweepingCheck': no collision, sweeping parameter outside of allowable range, with "+wallType+" surface.");
    return null; // no collision
  }
  else {
    const intersection = new Vec2D (relevantECB1Point.x + s*(relevantECBpPoint.x-relevantECB1Point.x), relevantECB1Point.y + s*(relevantECBpPoint.y-relevantECB1Point.y));
    if (getXOrYCoord(intersection, xOrY) > getXOrYCoord(wallTopOrRight, xOrY) || getXOrYCoord(intersection, xOrY) < getXOrYCoord(wallBottomOrLeft, xOrY)) {
      console.log("'pointSweepingCheck': no collision, intersection point outside of "+wallType+" surface.");
      return null; // no collision
    }
    else {
      let newPosition = null; // initialising

      let additionalPushout = additionalOffset;
      switch(wallType) {
        case "l":
        case "c":
          additionalPushout = -additionalOffset;
          break;
        default:
          break;
      }

      switch (wallType){
        case "c":
        case "g":
        case "p": // vertical pushout
          const yPushout = pushoutVertically (wall, wallType, wallIndex, stage, connectednessFunction, [ecbpSame, new Vec2D( ecbpSame.x , ecbpSame.y -1) ]);
          newPosition = new Vec2D( position.x, position.y + yPushout - ecbpSame.y + additionalPushout );
          // still have: angularParameter = same
          break;
        case "l":
        case "r": // horizontal pushout
        default:
          const pushoutAnswer = pushoutHorizontally ( wall, wallType, wallIndex, stage, connectednessFunction, same, ecbpSame, ecbpTop);
          const xPushout   = pushoutAnswer[0];
          angularParameter = pushoutAnswer[1];
          newPosition = new Vec2D( position.x + xPushout + additionalPushout, position.y);
          break;
      }
      console.log("'pointSweepingCheck': collision, crossing relevant ECB point, "+wallType+" surface. Sweeping parameter s="+s+".");
      return ( [wallType, newPosition, s, angularParameter] );
    }
  }
};

// in this function, we are considering a line that is sweeping,
// from the initial line 'line1' passing through the two points p1 = (x1,y1), p2 = (x2,y2)
// to the final line 'line2' passing through the two points p3 = (x3,y3) and p4 = (x4,y4)
// there are two sweeping parameters: 
//   't', which indicates how far along each line we are
//   's', which indicates how far we are sweeping between line1 and line2 (the main sweeping parameter)
// for instance:
//  s=0 means we are on line1,
//  s=1 means we are on line2,
//  t=0 means we are on the line between p1 and p3,
//  t=1 means we are on the line between p2 and p4
// this function returns a specific value for each of t and s,
// which correspond to when the swept line hits the origin O (at coordinates (0,0))
// if either of the parameters is not between 0 and 1, this function instead returns null
// see '/doc/linesweep.png' for a visual representation of the situation
function lineSweepParameters( line1 : [Vec2D, Vec2D], line2 : [Vec2D, Vec2D], flip : boolean = false) : [number, number] | null {
  let sign = 1;
  if (flip) {
    sign = -1;
  }
  const x1 = line1[0].x;
  const x2 = line1[1].x;
  const x3 = line2[0].x;
  const x4 = line2[1].x;
  const y1 = line1[0].y;
  const y2 = line1[1].y;
  const y3 = line2[0].y;
  const y4 = line2[1].y;

  const a0 = x2*y1 - x1*y2;
  const a1 = x4*y1 - 2*x2*y1 + 2*x1*y2 - x3*y2 + x2*y3 - x1*y4;
  const a2 = x2*y1 - x4*y1 - x1*y2 + x3*y2 - x2*y3 + x4*y3 + x1*y4 - x3*y4;

  // s satisfies the equation:   a0 + a1*s + a2*s^2 = 0
  const s = solveQuadraticEquation( a0, a1, a2, sign );

  if (s === null || isNaN(s) || s === Infinity || s < 0 || s > 1) {
    return null; // no real solution
  }
  else {
    const t = ( s*(x1 - x3) - x1) / ( x2 - x1 + s*(x1 - x2 - x3 + x4) );
    
    if (isNaN(t) || t === Infinity || t < 0 || t > 1) {
      return null;
    }
    else {
      return [t,s];
    }
  }
};


function edgeSweepingCheck( ecb1 : ECB, ecbp : ECB, same : number, other : number
                          , position : Vec2D, counterclockwise : boolean
                          , corner : Vec2D, wallType : string) : null | [null | string, Vec2D, number, number] {

  // the relevant ECB edge, that might collide with the corner, is the edge between ECB points 'same' and 'other'
  let interiorECBside = "l";   
  if (counterclockwise === false) {
    interiorECBside = "r";    
  }

  if (!isOutside ( corner, ecbp[same], ecbp[other], interiorECBside) && isOutside ( corner, ecb1[same], ecb1[other], interiorECBside) ) {

    let [t,s] = [0,0];
  
    // we sweep a line,
    // starting from the relevant ECB1 edge, and ending at the relevant ECBp edge,
    // and figure out where this would intersect the corner
    
    // first we recenter everything around the corner,
    // as the 'lineSweepParameters' function calculates collision with respect to the origin
  
    const recenteredECB1Edge = [ new Vec2D( ecb1[same ].x - corner.x, ecb1[same ].y - corner.y )
                               , new Vec2D( ecb1[other].x - corner.x, ecb1[other].y - corner.y ) ];
    const recenteredECBpEdge = [ new Vec2D( ecbp[same ].x - corner.x, ecbp[same ].y - corner.y )
                               , new Vec2D( ecbp[other].x - corner.x, ecbp[other].y - corner.y ) ];
  
    // in the line sweeping, some tricky orientation checks show that a minus sign is required precisely in the counterclockwise case
    // this is what the third argument to 'lineSweepParameters' corresponds to
    const lineSweepResult = lineSweepParameters( recenteredECB1Edge, recenteredECBpEdge, counterclockwise );
    
    if (! (lineSweepResult === null) ) {
      [t,s] = lineSweepResult;
      let newPosition = null; // initialising

      let additionalPushout = additionalOffset; // additional pushout
      if (same === 1 || other === 1) {
        additionalPushout = -additionalOffset;
      }
      
      const xIntersect = coordinateIntercept( [ ecbp[same], ecbp[other] ], [ corner, new Vec2D( corner.x+1, corner.y ) ]).x;
      newPosition = new Vec2D( position.x + corner.x - xIntersect + additionalPushout, position.y);
      let same2 = same;
      let other2 = other;
      if (same === 0 && other === 3) {
        same2 = 4;
      }
      else if (same === 3 && other === 0) {
        other2 = 4;
      }
      const angularParameter = same2 + (xIntersect - ecbp[same].x) / (ecbp[other].x - ecbp[same].x) * (other2 - same2);
      console.log("'edgeSweepingCheck': collision, relevant edge of ECB has moved across "+wallType+" corner. Sweeping parameter s="+s+".");
      return ( [null, newPosition, s, angularParameter] ); // s is the sweeping parameter, t just moves along the edge
    }
    else {
      console.log("'edgeSweepingCheck': no edge collision, relevant edge of ECB does not cross "+wallType+" corner.");
      return null;
    }
  }
  else {
    console.log("'edgeSweepingCheck': no edge collision, "+wallType+" corner did not switch relevant ECB edge sides.");
    return null;
  }
};


// this function returns the absolute horizontal pushout vector for a wall, and the angular parameter
// this function recursively looks at adjacent walls if necessary
function pushoutHorizontally ( wall : [Vec2D, Vec2D], wallType : string, wallIndex : number
                             , stage : Stage, connectednessFunction : ConnectednessFunction
                             , same : number, ecbpSame : Vec2D, ecbpTop : Vec2D) : [number, number] {
  console.log("'pushoutHorizontally' working with wall "+wallType+""+wallIndex+".");

  const wallRight  = extremePoint(wall, "r");
  const wallLeft   = extremePoint(wall, "l");
  const wallTop    = extremePoint(wall, "t");
  const wallBottom = extremePoint(wall, "b");

  const sameLine = [ ecbpSame, new Vec2D( ecbpSame.x + 1, ecbpSame.y ) ]; // horizontal line though same-side projected ECB point
  const topLine  = [ ecbpTop , new Vec2D( ecbpTop.x  + 1,  ecbpTop.y ) ];
  const xIntersect = coordinateIntercept(wall, sameLine).x;
  const wallAngle = lineAngle( [wallBottom, wallTop]); // bottom to top
  const ecbAngle  = lineAngle( [ecbpSame  , ecbpTop]); // also bottom to top


  // we are assuming that the chains of connected surfaces go clockwise:
  //    - top to bottom for right walls
  //    - bottom to top for left walls


  let nextWallToTheSideTypeAndIndex = null;
  let nextWallToTheSide = null; // initialising

  // right wall by default
  let wallSide = wallRight;
  let sign = 1;
  let dir = "l";
  if (wallType === "l") { // left wall situation
    wallSide = wallLeft;
    sign = -1;
    dir = "r";
  }

  if (sign * wallAngle < sign * ecbAngle) { // top ECB edge situation, might need to push out at corners
    // initialise some potentially useful objects
    let nextWallToTheSideTop    = null;
    let nextWallToTheSideBottom = null;
    let nextWallToTheSideAngle  = null;
    if (ecbpTop.y <= wallTop.y) { // in this case, just push the top point out
      console.log("'pushoutHorizontally': top case, pushing out top point.");
      return [ coordinateIntercept(wall, topLine).x - ecbpTop.x, 2]; 
    }
    else if (ecbpSame.y >= wallTop.y) { // in this case, push the side point out
      nextWallToTheSideTypeAndIndex = connectednessFunction( [wallType, wallIndex] , dir);
      if (nextWallToTheSideTypeAndIndex === null || nextWallToTheSideTypeAndIndex[0] !== wallType) {
        console.log("'pushoutHorizontally': top case, pushing out side point (no relevant adjacent wall).");
        return [wallSide.x - ecbpSame.x, same];
      }
      else {
        if (wallType === "r") {
          nextWallToTheSide = stage.wallR[ nextWallToTheSideTypeAndIndex[1] ];
        }
        else {
          nextWallToTheSide = stage.wallL[ nextWallToTheSideTypeAndIndex[1] ];
        }
        nextWallToTheSideTop    = extremePoint(nextWallToTheSide, "t");
        nextWallToTheSideBottom = extremePoint(nextWallToTheSide, "b");
        nextWallToTheSideAngle  = lineAngle( [nextWallToTheSideBottom, nextWallToTheSideTop]);
        if (sign * nextWallToTheSideAngle >= sign * ( Math.PI / 2) ) {
          console.log("'pushoutHorizontally': top case, pushing out side point (adjacent wall is useless).");
          return [wallSide.x - ecbpSame.x, same];
        }
        else {
          console.log("'pushoutHorizontally': top case, deferring to adjacent wall.");
          return pushoutHorizontally(nextWallToTheSide , wallType, nextWallToTheSideTypeAndIndex[1], stage, connectednessFunction, same, ecbpSame, ecbpTop);
        }
      }
    }
    else { // this is the potential corner pushout case
      const cornerLine = [wallSide, new Vec2D (wallSide.x+1,wallSide.y )]; // horizontal line through top corner of wall
      nextWallToTheSideTypeAndIndex = connectednessFunction( [wallType, wallIndex] , dir);
      if (nextWallToTheSideTypeAndIndex === null || nextWallToTheSideTypeAndIndex[0] !== wallType) {
        // place the relevant top ECB edge on the corner
        const xIntercept1 = coordinateIntercept( [ecbpSame, ecbpTop], cornerLine ).x;
        const angularParameter1 = same + (xIntercept1 - ecbpSame.x) / (ecbpTop.x - ecbpSame.x) * (2-same);
        console.log("'pushoutHorizontally': top case, directly pushing out to corner (no relevant adjacent wall).");
        return [wallSide.x - xIntercept1, angularParameter1];
      }
      else {
        if (wallType === "r") {
          nextWallToTheSide = stage.wallR[ nextWallToTheSideTypeAndIndex[1] ];
        }
        else {
          nextWallToTheSide = stage.wallL[ nextWallToTheSideTypeAndIndex[1] ];
        }
        nextWallToTheSideTop    = extremePoint(nextWallToTheSide, "t");
        nextWallToTheSideBottom = extremePoint(nextWallToTheSide, "b");
        nextWallToTheSideAngle  = lineAngle( [nextWallToTheSideBottom, nextWallToTheSideTop]);
        if (sign * nextWallToTheSideAngle > sign * ecbAngle) {
          // place the relevant ECB edge on the corner
          const xIntercept2 = coordinateIntercept( [ecbpSame, ecbpTop], cornerLine ).x;
          const angularParameter2 = same + (xIntercept2 - ecbpSame.x) / (ecbpTop.x - ecbpSame.x) * (2-same);
          console.log("'pushoutHorizontally': top case, directly pushing out to corner (adjacent wall is useless).");
          return [wallSide.x - xIntercept2, angularParameter2];
        }
        else {
          console.log("'pushoutHorizontally': top case, deferring corner pushing to adjacent wall.");
          return pushoutHorizontally( nextWallToTheSide , wallType, nextWallToTheSideTypeAndIndex[1], stage, connectednessFunction, same, ecbpSame, ecbpTop);
        }

      }

    }
  }
  else { // now only dealing with the same-side ECB point
    if ( sign * xIntersect <= sign * wallSide.x ) {
      console.log("'pushoutHorizontally': side case, directly pushing out side point.");
      return [xIntersect - ecbpSame.x, same];
    }
    else {        
      if (wallAngle > Math.PI) {
        nextWallToTheSideTypeAndIndex = connectednessFunction( [wallType, wallIndex] , "r");
      }
      else {
        nextWallToTheSideTypeAndIndex = connectednessFunction( [wallType, wallIndex] , "l");
      }

      if (nextWallToTheSideTypeAndIndex === null || nextWallToTheSideTypeAndIndex[0] !== wallType) {
        console.log("'pushoutHorizontally': side case, directly pushing out side point (no relevant adjacent wall).");
        return [xIntersect - ecbpSame.x, same];
      }
      else {
        if (wallType === "r") {
          nextWallToTheSide = stage.wallR[ nextWallToTheSideTypeAndIndex[1] ];
        }
        else {
          nextWallToTheSide = stage.wallL[ nextWallToTheSideTypeAndIndex[1] ];
        }
        if (sign * extremePoint(nextWallToTheSide, wallType).x <= sign * wallSide.x ) {
          console.log("'pushoutHorizontally': side case, directly pushing out side point (adjacent wall is useless).");
          return [xIntersect - ecbpSame.x, same];
        }
        else {
          console.log("'pushoutHorizontally': side case, deferring side pushing to adjacent wall.");
          return pushoutHorizontally( nextWallToTheSide , wallType, nextWallToTheSideTypeAndIndex[1], stage, connectednessFunction, same, ecbpSame, ecbpTop);
        }
      }
    }
  }

};


// this function returns the relative vertical pushout vector, relative to the same-side ECB point
// this function recursively looks at adjacent surfaces if necessary
function pushoutVertically ( wall : [Vec2D, Vec2D], wallType : string, wallIndex : number
                           , stage : Stage, connectednessFunction : ConnectednessFunction, line : [Vec2D, Vec2D]) : number {
  console.log("'pushoutVertically' working with wall "+wallType+""+wallIndex+".");

  const wallRight  = extremePoint(wall, "r");
  const wallLeft   = extremePoint(wall, "l");
  const wallTop    = extremePoint(wall, "t");
  const wallBottom = extremePoint(wall, "b");

  const yIntersect = coordinateIntercept(wall, line).y; // line is the vertical line passing through the same-side projected ECB point
  const wallAngle = lineAngle([wallLeft,wallRight]); // left then right
  // we are assuming that the chains of connected surfaces go clockwise:
  //    - left to right for grounds and platforms
  //    - right to left for ceilings

  let wallOpposite = wallTop; // ground or platform by default
  let sign = 1;
  if (wallType === "c") {
    wallOpposite = wallBottom;
    sign = -1;
  }

  if ( sign * yIntersect > sign * wallOpposite.y) {

    let dir = "r";
    if ( wallAngle > Math.PI ) { 
      dir = "l";
    }

    const nextSurfaceToTheSideTypeAndIndex = connectednessFunction( [wallType, wallIndex], dir);
    if (     nextSurfaceToTheSideTypeAndIndex === null 
         || (   wallType === "c"                      && nextSurfaceToTheSideTypeAndIndex[0] !== "c" )
         || ( ( wallType === "g" || wallType === "p") && nextSurfaceToTheSideTypeAndIndex[0] !== "g" 
                                                      && nextSurfaceToTheSideTypeAndIndex[0] !== "p" ) ) {
      console.log("'pushoutVertically': directly pushing out ECB point (no relevant adjacent surface)");
      return wallOpposite.y;
    }
    else {
      let nextSurfaceToTheSide = null; // initialising
      const nextSurfaceToTheSideType = nextSurfaceToTheSideTypeAndIndex[0];
      switch(nextSurfaceToTheSideType) {
        case "g":
          nextSurfaceToTheSide = stage.ground  [ nextSurfaceToTheSideTypeAndIndex[1] ];
          break;
        case "c":
          nextSurfaceToTheSide = stage.ceiling [ nextSurfaceToTheSideTypeAndIndex[1] ];
          break;
        case "p":
          nextSurfaceToTheSide = stage.platform[ nextSurfaceToTheSideTypeAndIndex[1] ];
          break;
        default:
          console.log("error in 'pushoutVertically': surface type neither ground, platform nor ceiling.");
          break;
      }
      let nextSurfaceToTheSideOpposite = null; // initialising
      if (nextSurfaceToTheSide === null) {
        console.log("'pushoutVertically': directly pushing out ECB point (no relevant adjacent surface)");
        return wallOpposite.y;
      }
      else if (wallType === "c") {
        nextSurfaceToTheSideOpposite = extremePoint(nextSurfaceToTheSide, "b");
      }
      else {
        nextSurfaceToTheSideOpposite = extremePoint(nextSurfaceToTheSide, "t");
      }

      if (sign * nextSurfaceToTheSideOpposite.y < sign * wallOpposite.y) {
        console.log("'pushoutVertically': directly pushing out ECB point (next surface is useless)");
        return wallOpposite.y;
      }
      else {
        console.log("'pushoutVertically': deferring to adjacent surface.");
        return pushoutVertically( nextSurfaceToTheSide, nextSurfaceToTheSideType
                                , nextSurfaceToTheSideTypeAndIndex[1], stage, connectednessFunction, line);
      }
    }

  }

  else {
    console.log("'pushoutVertically': directly pushing out ECB point.");
    return yIntersect;
  }

};

// ecbp : projected ECB
// ecb1 : old ECB
// function return type: either null (no collision) or a quadruple [touchingWall, proposed new player position, sweeping parameter, angular parameter]
// touchingWall is either null (for a corner collision) or the type of surface that was collided
// the sweeping parameter s corresponds to the location of the collision, between ECB1 and ECBp
// the angular parameter is the location at which the ECB is now touching the surface after being pushed out, from 0 to 4
// terminology in the comments: a wall is a segment with an inside and an outside,
// which is contained in an infinite line, extending both ways, which also has an inside and an outside
function findCollision (ecbp : ECB, ecb1 : ECB, position : Vec2D
                       , wall : [Vec2D, Vec2D], wallType : string, wallIndex : number
                       , stage : Stage, connectednessFunction : ConnectednessFunction) : null | [null | string, Vec2D, number, number] {

// STANDING ASSUMPTIONS
// the ECB can only collide a ground/platform surface on its bottom point (or a bottom edge on a corner of the ground/platform)
// the ECB can only collide a ceiling surface on its top point (or a top edge on a corner)
// the ECB can only collide a left wall on its right or top points (or a right edge on a corner)
// the ECB can only collide a right wall on its left or top points (or a left edge on a corner)
// walls and corners push out horizontally, grounds/ceilings/platforms push out vertically
// the chains of connected surfaces go clockwise:
//    - left to right for grounds
//    - top to bottom for right walls
//    - right to left for ceilings
//    - bottom to top for left walls

  const wallTop    = extremePoint(wall, "t");
  const wallBottom = extremePoint(wall, "b");
  const wallLeft   = extremePoint(wall, "l");
  const wallRight  = extremePoint(wall, "r");

  // right wall by default
  let wallTopOrRight = wallTop;
  let wallBottomOrLeft = wallBottom;
  let extremeWall = wallRight;
  let extremeSign = 1;
  let same = 3;
  let opposite = 1;
  let xOrY = 1; // y by default
  let isPlatform = false;
  let flip = false;
  let sign = 1;

  let other = 0; // this will be calculated later, not in the following switch statement

  switch(wallType) {
    case "l": // left wall
      same = 1;
      opposite = 3;
      flip = true;
      sign = -1;
      extremeWall = wallLeft;
      extremeSign = -1;
      break;
    case "p": // platform
      isPlatform = true;
    case "g": // ground
    case "b":
    case "d":
      same = 0;
      opposite = 2;
      wallTopOrRight  = wallRight;
      wallBottomOrLeft = wallLeft;
      extremeWall = wallTop;
      xOrY = 0;
      flip = true;
      sign = -1;
      break;
    case "c": // ceiling
    case "t":
    case "u":
      same = 2;
      opposite = 0;
      wallTopOrRight  = wallRight;
      wallBottomOrLeft = wallLeft;
      extremeSign = -1;
      extremeWall = wallBottom;
      xOrY = 0;
      break;
    default: // right wall by default
      break;
  }

  const wallAngle = lineAngle([wallBottomOrLeft, wallTopOrRight]);
  const checkTopInstead = (wallType === "l" || wallType === "r") && (sign * wallAngle < sign * lineAngle([ecbp[same], ecbp[2]]));

  // first check if player ECB was even near the wall
  if (    (ecbp[0].y > wallTop.y    && ecb1[0].y > wallTop.y   ) // player ECB stayed above the wall
       || (ecbp[2].y < wallBottom.y && ecb1[2].y < wallBottom.y) // played ECB stayed below the wall
       || (ecbp[3].x > wallRight.x  && ecb1[3].x > wallRight.x ) // player ECB stayed to the right of the wall
       || (ecbp[1].x < wallLeft.x   && ecb1[1].x < wallLeft.x  ) // player ECB stayed to the left of the wall
     ) {
    console.log("'findCollision': no collision, ECB not even near "+wallType+""+wallIndex+".");
    return null;
  }
  else {

    // if the surface is a platform, and the bottom ECB point is below the platform, we shouldn't do anything
    if ( isPlatform ) {
      if ( !isOutside ( ecb1[same], wallTopOrRight, wallBottomOrLeft, wallType )) {
        console.log("'findCollision': no collision, bottom ECB1 point was below p"+wallIndex+".");
        return null;
      }
    }

    // -------------------------------------------------------------------------------------------------------------------------------------------------------
    // now, we check whether the ECB is colliding on an edge, and not a vertex

    // first, figure out which is the relevant ECB edge that could collide at the corner
    // we know that one of the endpoints of this edge is the same-side ECB point of the wall,
    // we are left to find the other, which we'll call 'other'


    let counterclockwise = true; // whether (same ECB point -> other ECB point) is counterclockwise or not
    let closestEdgeCollision = null; // false for now
    let corner : null | Vec2D = null;

    // case 1
    if ( getXOrYCoord(ecb1[same], xOrY) > getXOrYCoord(wallTopOrRight, xOrY) ) {
      counterclockwise = !flip;
      other = turn(same, counterclockwise);
      if ( getXOrYCoord(ecbp[other], xOrY) < getXOrYCoord(wallTopOrRight, xOrY) ) { 
        corner = wallTopOrRight;
      }
    }

    // case 2
    else if ( getXOrYCoord(ecb1[same], xOrY) < getXOrYCoord(wallBottomOrLeft, xOrY) ) {
      counterclockwise = flip;
      other = turn(same, counterclockwise);
      if ( getXOrYCoord(ecbp[other], xOrY) > getXOrYCoord(wallBottomOrLeft, xOrY) ) { 
        corner = wallBottomOrLeft;
      }
    }

    let edgeSweepResult = null;
    let otherEdgeSweepResult = null;
    
    if (corner !== null) {
      // the relevant ECB edge, that might collide with the corner, is the edge between ECB points 'same' and 'other'
      let interiorECBside = "l";
      if (counterclockwise === false) {
        interiorECBside = "r";    
      }

      if (!isOutside (corner, ecbp[same], ecbp[other], interiorECBside) && isOutside (corner, ecb1[same], ecb1[other], interiorECBside) ) {
        edgeSweepResult = edgeSweepingCheck( ecb1, ecbp, same, other, position, counterclockwise, corner, wallType);
      }
    }

    if (checkTopInstead) {
      // unless we are dealing with a wall where the ECB can collided on the topmost point, in whih case 'same' and 'top' are relevant
      let otherCounterclockwise = false; // whether ( same ECB point -> top ECB point) is counterclockwise
      let otherCorner = wallRight;
      if (wallType === "l") {
        otherCounterclockwise = true;
        otherCorner = wallLeft;
      }

      let otherInteriorECBside = "l";
      if (otherCounterclockwise === false) {
        otherInteriorECBside = "r";
      }

      if ( !isOutside(otherCorner, ecbp[same], ecbp[2], otherInteriorECBside) && isOutside (otherCorner, ecb1[same], ecb1[2], otherInteriorECBside) ) {
        otherEdgeSweepResult = edgeSweepingCheck( ecb1, ecbp, same, 2, position, otherCounterclockwise, otherCorner, wallType);
      }
    }

    // if only one of the two ECB edges (same-other / same-top) collided, take that one
    if (edgeSweepResult === null) {
      if (otherEdgeSweepResult !== null) {
        closestEdgeCollision = otherEdgeSweepResult;
      }
    }
    else if (otherEdgeSweepResult === null) {
      if (edgeSweepResult !== null) {
        closestEdgeCollision = edgeSweepResult;
      }
    }
    // otherwise choose the collision with smallest sweeping parameter
    else if ( otherEdgeSweepResult[2] > edgeSweepResult[2] ) {
      closestEdgeCollision = edgeSweepResult;
    }
    else {
      closestEdgeCollision = otherEdgeSweepResult;
    }
    

    // end of edge case checking
    // -------------------------------------------------------------------------------------------------------------------------------------------------------

    let closestPointCollision = null;

    // now we run some checks to see if the relevant projected ECB point was already on the other side of the wall
    // this prevents collisions being detected when going through a surface in reverse

    if ( checkTopInstead && !isOutside( ecb1[2], wallRight, wallLeft, "c" ) ) { 
      console.log("'findCollision': no point collision with "+wallType+""+wallIndex+", top ECB1 point on the inside side of the wall. ");
    }
    else if ( !checkTopInstead && !isOutside ( ecb1[same], wallTopOrRight, wallBottomOrLeft, wallType ) ) {
      console.log("'findCollision': no point collision with "+wallType+""+wallIndex+", same side ECB1 point on the inside side of the wall. ");
    }
    else {
       // point sweeping check
      closestPointCollision = pointSweepingCheck ( wall, wallType, wallIndex, wallTopOrRight, wallBottomOrLeft, stage, connectednessFunction
                                                 , xOrY, position, same, ecb1[same], ecbp[same], ecb1[2], ecbp[2]);
    }

  
    let [finalCollision, finalCollisionType] = [null,"(?)"];

    // if we have only one collision type (point/edge), take that one
    if (closestEdgeCollision === null ) {
      finalCollision = closestPointCollision;
      finalCollisionType = "point";
    }
    else if (closestPointCollision === null) {
      finalCollision = closestEdgeCollision;
      finalCollisionType = "edge";
    }
    // otherwise choose the collision with smallest sweeping parameter
    else if (closestEdgeCollision[2] > closestPointCollision[2]) {
      finalCollision = closestPointCollision;
      finalCollisionType = "point";
    }
    else {
      finalCollision = closestEdgeCollision;
      finalCollisionType = "edge";
    }

    if (finalCollision === null) {
      console.log("'findCollision': sweeping determined no collision with "+wallType+""+wallIndex+".");
    }
    else {
      console.log("'findCollision': "+finalCollisionType+" collision with "+wallType+""+wallIndex+" and sweeping parameter s="+finalCollision[2]+".");
    }
    return finalCollision;

  }
};


type MaybeCenterAndTouchingDataType = null | [Vec2D, null | [string, number], number];
type LabelledSurface = [[Vec2D, Vec2D], [string, number]];

// this function finds the first (non-impotent) collision as the ECB1 moves to the ECBp
// return type: either null (no collision), or a new center, with a label according to which surface was collided (null if a corner)
function findAndResolveCollision( ecbp : ECB, ecb1 : ECB, position : Vec2D
                                , wallAndThenWallTypeAndIndexs : Array<LabelledSurface>
                                , stage : Stage, connectednessFunction : ConnectednessFunction ) : MaybeCenterAndTouchingDataType {
  const suggestedMaybeCenterAndTouchingData : Array<MaybeCenterAndTouchingDataType> = [null]; // initialise list of new collisions
  const collisionData = wallAndThenWallTypeAndIndexs.map( 
                                         // [  [ touchingWall, position, s, angularParameter ]  , touchingType ]
          (wallAndThenWallTypeAndIndex)  => [ findCollision (ecbp, ecb1, position, wallAndThenWallTypeAndIndex[0]
                                                            , wallAndThenWallTypeAndIndex[1][0], wallAndThenWallTypeAndIndex[1][1]
                                                            , stage, connectednessFunction )
                                            , wallAndThenWallTypeAndIndex[1] ]);

  for (let i = 0; i < collisionData.length; i++) {
    if (collisionData[i][0] !== null) { 
      suggestedMaybeCenterAndTouchingData.push( [collisionData[i][0][1], collisionData[i][1], collisionData[i][0][2] ]);
    }
  }

  return closestCenterAndTouchingType(suggestedMaybeCenterAndTouchingData);
};

// The main collision routine proceeds as follows:
//   1. Find the first collision (ECB going from ECB1 to ECBp).
//      - If no collision was found, end.
//      - Otherwise, record the collision type, and continue.
//   2. Push out the ECBp according to collision. If collision was with ground/platform, ground the player.
//   3. Now check for collisions in the orthogonal direction, and push ECBp out if necessary. If collision was with ground/platform, ground the player.
//   4. Proceed to use an ECB inflation procedure to check whether ECB squashing is necessary.
//   5. Return the new player position, relevant collision surfaces, and ECB squash factor.
export function collisionRoutine ( ecbp : ECB, ecb1 : ECB, position : Vec2D
                                 , walls     : Array<LabelledSurface>
                                 , ceilings  : Array<LabelledSurface>
                                 , grounds   : Array<LabelledSurface>
                                 , platforms : Array<LabelledSurface>
                                 , stage : Stage
                                 , connectednessFunction : ConnectednessFunction
                                 , oldGroundedSurface : null | [string, number]
                                 , notIgnoringPlatforms : bool ) : [ Vec2D // new position
                                                                   , null | [string, number] // first collision label
                                                                   , null | [string, number] // second collision label
                                                                   , null | number // ECB scaling factor
                                                                   ] {
  let relevantSurfaces = walls;
  let ecbSquashFactor = null;
  let groundedSurface = oldGroundedSurface;

  if (groundedSurface === null) {
    relevantSurfaces = relevantSurfaces.concat(ceilings).concat(grounds);
    if (notIgnoringPlatforms) {
      relevantSurfaces = relevantSurfaces.concat(platforms);
    }
  }

  let nonIgnoredSurfaces = walls.concat(ceilings).concat(grounds);
  if (notIgnoringPlatforms) {
    nonIgnoredSurfaces = nonIgnoredSurfaces.concat(platforms);
  }

  // first, find the closest collision
  const closestCollision = findAndResolveCollision(ecbp, ecb1, position, relevantSurfaces, stage, connectednessFunction);
  if (closestCollision === null) {
    // if no collision occured, end
    return [position, null, null, null];
  }
  else {
    // otherwise, check collision in orthogonal direction
    const [newPosition, surfaceTypeAndIndex, angularParameter] = closestCollision;
    const vec = new Vec2D (newPosition.x - position.x, newPosition.y - position.y);
    const newecbp = moveECB (ecbp, vec);

    if (surfaceTypeAndIndex !== null && (surfaceTypeAndIndex[0] === "g" || surfaceTypeAndIndex[0] === "p")) {
      // ground the player if collision with ground occurred
      groundedSurface = surfaceTypeAndIndex;
    }

    let orthRelevantSurfaces = null;

    if (surfaceTypeAndIndex === null || surfaceTypeAndIndex[0] === "l" || surfaceTypeAndIndex[0] === "r") {
      if (groundedSurface === null) {
        orthRelevantSurfaces = grounds.concat(ceilings);
        if (notIgnoringPlatforms) {
          orthRelevantSurfaces = orthRelevantSurfaces.concat(platforms);
        }
      }
    }
    else {
      orthRelevantSurfaces = walls;
    }

    if (orthRelevantSurfaces === null) {
      // if there are no orthogonal collisions, run ECB squashing routine
      ecbSquashFactor = inflateECB (newecbp, angularParameter, nonIgnoredSurfaces);
      return [newPosition, surfaceTypeAndIndex, null, ecbSquashFactor];
    }
    else {
      // otherwise, find the closest one
      const orthClosestCollision = findAndResolveCollision( newecbp, ecb1, position, orthRelevantSurfaces, stage, connectednessFunction);
      if (orthClosestCollision === null) {
        // if there are no orthogonal collisions, run ECB squashing routine
        ecbSquashFactor = inflateECB (newecbp, angularParameter, nonIgnoredSurfaces);
        return [newPosition, surfaceTypeAndIndex, null, ecbSquashFactor];
      }
      else {
        const [orthNewPosition, orthSurfaceTypeAndIndex, orthAngularParameter] = orthClosestCollision;
        const orthVec = new Vec2D(orthNewPosition.x - position.x, orthNewPosition.y - position.y);
        const orthNewecbp = moveECB (ecbp, orthVec);
        ecbSquashFactor = inflateECB (orthNewecbp, orthAngularParameter, nonIgnoredSurfaces);
        return [orthNewPosition, surfaceTypeAndIndex, orthSurfaceTypeAndIndex, ecbSquashFactor];
      }
    }
  }
};

// finds the ECB squash factor by inflating the ECB from the point on the ECB given by the angular parameter
function inflateECB ( ecb : ECB, angularParameter : number, relevantSurfaces : Array<LabelledSurface>) : null | number {
  return 1; // TODO
}


// finds the maybeCenterAndTouchingType collision with smallest sweeping parameter
// recall that a 'maybeCenterAndTouchingType' is given by one of the following three options: 
//          option 1: 'false'                              (no collision) 
//          option 2: '[newPosition, false, s]             (collision, but no longer touching) 
//          option 3: '[newPosition, wallTypeAndIndex, s]' (collision, still touching wall with given type and index)
// s is the sweeping parameter
function closestCenterAndTouchingType(maybeCenterAndTouchingTypes : Array<MaybeCenterAndTouchingDataType>) : MaybeCenterAndTouchingDataType {
  let newMaybeCenterAndTouchingType = null;
  let start = -1;
  const l = maybeCenterAndTouchingTypes.length;

  // start by looking for the first possible new position
  for (let i = 0; i < l; i++) {
    if (maybeCenterAndTouchingTypes[i] === null ) {
      // option 1: do nothing
    }
    else {
      // options 2 or 3: we have found a possible new position
      newMaybeCenterAndTouchingType = maybeCenterAndTouchingTypes[i];
      start = i+1;
      break;
    }
  }
  if ( newMaybeCenterAndTouchingType === null || start > l) {
    // no possible new positions were found in the previous loop
    return null;
  }
  else {
    // options 2 or 3: possible new positions, choose the one with smallest sweeping parameter
    for (let j = start; j < l; j++) {
      if (maybeCenterAndTouchingTypes[j] === null ) {
        // option 1: no new position proposed
        // do nothing
      }
      // otherwise, compare sweeping parameters
      else if (maybeCenterAndTouchingTypes[j][2] < newMaybeCenterAndTouchingType[2]) {
        // next proposed position has smaller sweeping parameter, so use it instead
        newMaybeCenterAndTouchingType = maybeCenterAndTouchingTypes[j];
      }
      else {
        // discard the next proposed position
      }
    }
    return newMaybeCenterAndTouchingType;
  }
};
