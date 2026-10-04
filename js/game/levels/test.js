// Test playground for movement/physics verification
export default {
  build(L) {
    L.start(0, 0, 8, Math.PI);
    L.island(0, 0, 0, 10, { clear: [[0, 8, 3]] });
    L.island(-16, 1.5, -6, 6);
    L.bridge([-9.5, 0, -2], [-11, 1.5, -5], 1.8);
    L.island(14, 2.5, -4, 6);
    L.ramp([8.5, 0, -1], [10.5, 2.5, -3], 2.4);
    L.block(4, 1.2, -6, 2, 1.2, 2, { style: 'wood' });
    L.block(6.5, 2.4, -7.5, 2, 2.4, 2, { style: 'wood' });
    L.block(4, 4.0, -10, 2.4, 1, 2.4, { style: 'candy' });
    L.stairs([-4, 0, -6], [-4, 3, -12], 2.4, 6, { style: 'stone' });
    L.slab(-4, 3, -16, 6, 6, { deco: true });
    L.pillar(0, 6, -20, 1.6, 2);
    L.island(0, 0, 26, 7);
    L.pickups.candyLine([0, 1, 4], [0, 1, -4], 8);
    L.pickups.candyArc([0, 1, 10], [0, 1, 19], 8, 3);
    L.pickups.candyRing(14, 3.4, -4, 3, 10);
    L.pickups.bigCandy(0, 7, -20);
    L.pickups.heart(-16, 2.3, -6);
    L.pickups.cookie('rabbit', -4, 3.9, -16);
  },
};
