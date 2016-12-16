// @flow


export class Vec2D { x : number; y : number; 
  constructor( x : number, y : number ) {
    this.x = x;
    this.y = y;
  };
  dot( vector : Vec2D) : number {
    return this.x * vector.x + this.y * vector.y;
  };
};

export function getXOrYCoord(vec : Vec2D, xOrY : number) : number {
  if (xOrY === 0) {
    return vec.x;
  }
  else {
    return vec.y;
  }
};

export function putXOrYCoord( coord : number, xOrY : number) : Vec2D {
  if (xOrY === 0) {
    return ( new Vec2D ( coord, 0 ) );
  }
  else {
    return ( new Vec2D ( 0, coord ) );
  }
};