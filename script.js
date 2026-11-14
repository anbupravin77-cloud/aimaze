// ============================================================================
// GRIDWORLD GYM — PURE VANILLA JAVASCRIPT DATA STRUCTURES & AI MAZE ENGINE
// 100% Standalone (index.html + style.css + script.js). Zero external deps.
// Implements:
//  1. Linked List Stack (LIFO) — push(), pop(), toArray() via .next pointers
//  2. Circular Queue (10-Slot Ring Buffer) — (rear + 1) % 10 modulo wrap
//  3. Normal FIFO Queue — enqueue() at rear, dequeue() from front
//  4. Singly Linked List — per-tile outgoing move chains (edgesHead -> .next)
// ============================================================================

const DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const DIR_DELTAS = {
  UP: [-1, 0],
  RIGHT: [0, 1],
  DOWN: [1, 0],
  LEFT: [0, -1],
};
const DIR_ARROWS = {
  UP: '↑',
  RIGHT: '→',
  DOWN: '↓',
  LEFT: '←',
};

// ============================================================================
// 1. SINGLY LINKED LIST NODE & MAZE TILE GRAPH
// ============================================================================

class GraphEdge {
  /**
   * @param {string} direction - 'UP' | 'RIGHT' | 'DOWN' | 'LEFT'
   * @param {GridNode} targetNode - Final destination tile after boost/portal
   * @param {GridNode} entryNode - Immediate adjacent tile stepped into before warp/slide
   * @param {string} transitionTag - 'NORMAL' | 'PORTAL_WARP' | 'BOOST_SLIDE'
   */
  constructor(direction, targetNode, entryNode = targetNode, transitionTag = 'NORMAL') {
    this.direction = direction;
    this.targetNode = targetNode;
    this.entryNode = entryNode;
    this.weight = 0.0; // Learned action score Q(s, a)
    this.visits = 0;
    this.transitionTag = transitionTag;
    this.next = null; // Explicit Singly Linked List pointer
  }
}

class GridNode {
  constructor(row, col, type = 'EMPTY') {
    this.row = col !== undefined ? row : 0;
    this.col = col !== undefined ? col : 0;
    this.id = `${row},${col}`;
    this.type = type; // 'START' | 'GOAL' | 'WALL' | 'TRAP' | 'BONUS' | 'BOOST' | 'PORTAL_A' | 'PORTAL_B' | 'EMPTY'
    this.boostDir = 'RIGHT';
    this.reward = this.computeDefaultReward(type);
    this.edgesHead = null; // Head pointer of Singly Linked List of valid moves
  }

  computeDefaultReward(type) {
    switch (type) {
      case 'GOAL':
        return 100;
      case 'TRAP':
        return -50;
      case 'BONUS':
        return 25;
      case 'WALL':
        return 0;
      case 'BOOST':
        return -0.5;
      case 'PORTAL_A':
      case 'PORTAL_B':
        return -0.5;
      default:
        return -1;
    }
  }

  setType(type, boostDir = 'RIGHT') {
    this.type = type;
    if (type === 'BOOST') {
      this.boostDir = boostDir;
    }
    this.reward = this.computeDefaultReward(type);
  }

  // Insert a move into this tile's Singly Linked List
  addEdge(direction, targetNode, entryNode = targetNode, transitionTag = 'NORMAL') {
    const newEdge = new GraphEdge(direction, targetNode, entryNode, transitionTag);
    if (!this.edgesHead) {
      this.edgesHead = newEdge;
    } else {
      let curr = this.edgesHead;
      while (curr.next !== null) {
        curr = curr.next;
      }
      curr.next = newEdge;
    }
    return newEdge;
  }

  // Traverse Singly Linked List to find a specific direction
  getEdge(direction) {
    let curr = this.edgesHead;
    while (curr !== null) {
      if (curr.direction === direction) return curr;
      curr = curr.next;
    }
    return null;
  }

  // Convert Singly Linked List to array for UI rendering
  getEdgesArray() {
    const list = [];
    let curr = this.edgesHead;
    while (curr !== null) {
      list.push(curr);
      curr = curr.next;
    }
    return list;
  }

  // Highest learned score among outgoing linked list edges
  getMaxQ() {
    if (this.type === 'GOAL' || this.type === 'TRAP' || this.type === 'WALL') {
      return 0;
    }
    let maxVal = -Infinity;
    let curr = this.edgesHead;
    while (curr !== null) {
      if (curr.weight > maxVal) maxVal = curr.weight;
      curr = curr.next;
    }
    return maxVal === -Infinity ? 0 : maxVal;
  }

  // Best linked list move (breaks ties randomly when scores are equal)
  getBestEdge() {
    let bestEdge = null;
    let maxVal = -Infinity;
    let curr = this.edgesHead;
    const ties = [];

    while (curr !== null) {
      if (curr.weight > maxVal + 1e-6) {
        maxVal = curr.weight;
        bestEdge = curr;
        ties.length = 0;
        ties.push(curr);
      } else if (Math.abs(curr.weight - maxVal) <= 1e-6) {
        ties.push(curr);
      }
      curr = curr.next;
    }
    if (ties.length > 1) {
      return ties[Math.floor(Math.random() * ties.length)];
    }
    return bestEdge;
  }
}

// ============================================================================
// 2. LINKED LIST STACK (LIFO) FOR EPISODE PATH & BACKWARD SCORE UPDATES
// ============================================================================

class StackNode {
  constructor(gridNode, edgeTaken, rewardReceived, stepIndex) {
    this.node = gridNode;
    this.edge = edgeTaken;
    this.reward = rewardReceived;
    this.stepIndex = stepIndex;
    this.tdError = 0;
    this.oldQ = edgeTaken ? edgeTaken.weight : 0;
    this.newQ = edgeTaken ? edgeTaken.weight : 0;
    this.next = null; // Explicit pointer to previous StackNode below
  }
}

class TrajectoryStack {
  constructor() {
    this.top = null;
    this.size = 0;
  }

  // O(1) Linked Stack Push
  push(gridNode, edgeTaken, rewardReceived, stepIndex) {
    const frame = new StackNode(gridNode, edgeTaken, rewardReceived, stepIndex);
    frame.next = this.top;
    this.top = frame;
    this.size++;
    return frame;
  }

  // O(1) Linked Stack Pop
  pop() {
    if (this.top === null) return null;
    const popped = this.top;
    this.top = this.top.next;
    popped.next = null;
    this.size--;
    return popped;
  }

  isEmpty() {
    return this.top === null;
  }

  clear() {
    this.top = null;
    this.size = 0;
  }

  toArray() {
    const arr = [];
    let curr = this.top;
    while (curr !== null) {
      arr.push(curr);
      curr = curr.next;
    }
    return arr;
  }
}

// ============================================================================
// 3. CIRCULAR QUEUE (10-SLOT FIXED RING BUFFER WITH MODULO WRAP)
// ============================================================================

class CircularBuffer {
  constructor(capacity = 10) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
    this.head = 0; // FRONT index (oldest item)
    this.tail = 0; // REAR index (next write slot)
    this.count = 0;
    this.totalWrites = 0;
    this.lastWrittenSlot = -1;
    this.lastSampledSlots = [];
  }

  // O(1) Modulo Enqueue
  enqueue(stateNode, edge, reward, nextNode) {
    const slotIndex = this.tail;
    const isOverwrite = this.count === this.capacity;

    this.buffer[slotIndex] = {
      slotIndex,
      stateId: stateNode.id,
      row: stateNode.row,
      col: stateNode.col,
      direction: edge.direction,
      reward,
      nextStateId: nextNode.id,
      edgeRef: edge,
      nextNodeRef: nextNode,
      stepStamp: ++this.totalWrites,
      overwritten: isOverwrite,
    };

    this.lastWrittenSlot = slotIndex;
    this.tail = (this.tail + 1) % this.capacity;
    if (isOverwrite) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.count++;
    }
  }

  // Sample random transitions from active ring slots for extra score replay
  sampleBatch(batchSize = 4) {
    if (this.count === 0) {
      this.lastSampledSlots = [];
      return [];
    }
    const availableIndices = [];
    for (let i = 0; i < this.capacity; i++) {
      if (this.buffer[i] !== null) availableIndices.push(i);
    }

    const picked = [];
    const sampledSlots = [];
    const k = Math.min(batchSize, availableIndices.length);

    for (let i = 0; i < k; i++) {
      const randIdx = Math.floor(Math.random() * availableIndices.length);
      const slot = availableIndices.splice(randIdx, 1)[0];
      sampledSlots.push(slot);
      picked.push(this.buffer[slot]);
    }

    this.lastSampledSlots = sampledSlots;
    return picked;
  }

  clear() {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.totalWrites = 0;
    this.lastWrittenSlot = -1;
    this.lastSampledSlots = [];
  }
}

// ============================================================================
// 4. NORMAL FIFO LINKED QUEUE FOR LEVEL-BY-LEVEL SHORTEST PATH (BFS)
// ============================================================================

class BFSQueueNode {
  constructor(gridNode) {
    this.node = gridNode;
    this.next = null;
  }
}

class LinkedQueue {
  constructor() {
    this.front = null;
    this.rear = null;
    this.size = 0;
  }

  // Add to REAR of Queue
  enqueue(gridNode) {
    const qNode = new BFSQueueNode(gridNode);
    if (this.rear === null) {
      this.front = qNode;
      this.rear = qNode;
    } else {
      this.rear.next = qNode;
      this.rear = qNode;
    }
    this.size++;
  }

  // Remove from FRONT of Queue
  dequeue() {
    if (this.front === null) return null;
    const removed = this.front;
    this.front = this.front.next;
    if (this.front === null) {
      this.rear = null;
    }
    removed.next = null;
    this.size--;
    return removed.node;
  }

  isEmpty() {
    return this.front === null;
  }

  toArray() {
    const items = [];
    let curr = this.front;
    while (curr !== null) {
      items.push(curr.node);
      curr = curr.next;
    }
    return items;
  }
}

// ============================================================================
// 5. 10x10 MAZE ENVIRONMENT & GRAPH BUILDER
// ============================================================================

class GridGraph {
  constructor(size = 10) {
    this.size = size;
    this.nodes = [];
    this.startNode = null;
    this.goalNode = null;
    this.initEmptyGrid();
  }

  initEmptyGrid() {
    this.nodes = [];
    for (let r = 0; r < this.size; r++) {
      const rowArr = [];
      for (let c = 0; c < this.size; c++) {
        rowArr.push(new GridNode(r, c, 'EMPTY'));
      }
      this.nodes.push(rowArr);
    }
  }

  getNode(r, c) {
    if (r < 0 || r >= this.size || c < 0 || c >= this.size) return null;
    return this.nodes[r][c];
  }

  findFirstNodeOfType(type) {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.nodes[r][c].type === type) return this.nodes[r][c];
      }
    }
    return null;
  }

  // Rebuild Singly Linked Lists of valid neighbor moves for every tile
  rebuildEdges(preserveWeights = true) {
    const savedWeights = new Map();

    if (preserveWeights) {
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          const node = this.nodes[r][c];
          let curr = node.edgesHead;
          while (curr !== null) {
            savedWeights.set(`${r},${c}:${curr.direction}`, {
              weight: curr.weight,
              visits: curr.visits,
            });
            curr = curr.next;
          }
        }
      }
    }

    const portalA = this.findFirstNodeOfType('PORTAL_A');
    const portalB = this.findFirstNodeOfType('PORTAL_B');

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const node = this.nodes[r][c];
        node.edgesHead = null;

        if (node.type === 'START') this.startNode = node;
        if (node.type === 'GOAL') this.goalNode = node;

        // Walls have no outgoing linked list edges
        if (node.type === 'WALL') continue;

        for (const dir of DIRS) {
          const [dr, dc] = DIR_DELTAS[dir];
          const nr = r + dr;
          const nc = c + dc;
          const neighbor = this.getNode(nr, nc);

          if (!neighbor || neighbor.type === 'WALL') continue;

          let finalTarget = neighbor;
          let transitionTag = 'NORMAL';

          // Portal teleportation: store neighbor as entryNode and twin portal as finalTarget
          if (neighbor.type === 'PORTAL_A' && portalB) {
            finalTarget = portalB;
            transitionTag = 'PORTAL_WARP';
          } else if (neighbor.type === 'PORTAL_B' && portalA) {
            finalTarget = portalA;
            transitionTag = 'PORTAL_WARP';
          } else if (neighbor.type === 'BOOST') {
            // Boost pad slides 1 extra tile in boostDir if clear
            const [bdr, bdc] = DIR_DELTAS[neighbor.boostDir || 'RIGHT'];
            const slideNode = this.getNode(neighbor.row + bdr, neighbor.col + bdc);
            if (slideNode && slideNode.type !== 'WALL') {
              finalTarget = slideNode;
              transitionTag = 'BOOST_SLIDE';
            }
          }

          const edge = node.addEdge(dir, finalTarget, neighbor, transitionTag);
          const key = `${r},${c}:${dir}`;
          if (preserveWeights && savedWeights.has(key)) {
            const prev = savedWeights.get(key);
            edge.weight = prev.weight;
            edge.visits = prev.visits;
          }
        }
      }
    }
  }

  resetAllWeights() {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        let curr = this.nodes[r][c].edgesHead;
        while (curr !== null) {
          curr.weight = 0.0;
          curr.visits = 0;
          curr = curr.next;
        }
      }
    }
  }

  // Level-by-level FIFO Queue (BFS) to verify reachability & find shortest path
  verifyReachabilityBFS() {
    if (!this.startNode || !this.goalNode) {
      return { reachable: false, shortestPath: [], waveOrder: [], snapshots: [] };
    }

    const queue = new LinkedQueue();
    const visited = new Set();
    const parentMap = new Map();
    const waveOrder = [];
    const snapshots = [];

    queue.enqueue(this.startNode);
    visited.add(this.startNode.id);

    let foundGoal = false;

    while (!queue.isEmpty()) {
      const currentQueueSnapshot = queue.toArray();
      const curr = queue.dequeue();
      waveOrder.push(curr);

      const enqueuedThisStep = [];
      let edgePtr = curr.edgesHead;
      while (edgePtr !== null) {
        const nextNode = edgePtr.targetNode;
        if (!visited.has(nextNode.id) && nextNode.type !== 'TRAP') {
          visited.add(nextNode.id);
          parentMap.set(nextNode.id, curr);
          queue.enqueue(nextNode);
          enqueuedThisStep.push(nextNode);
        }
        edgePtr = edgePtr.next;
      }

      snapshots.push({
        dequeuedNode: curr,
        enqueuedNodes: enqueuedThisStep,
        queueNodes: queue.toArray(),
        frontNode: queue.front ? queue.front.node : currentQueueSnapshot[0] || null,
        rearNode: queue.rear ? queue.rear.node : curr,
      });

      if (curr.id === this.goalNode.id) {
        foundGoal = true;
        break;
      }
    }

    const shortestPath = [];
    if (foundGoal) {
      let step = this.goalNode;
      while (step) {
        shortestPath.unshift(step);
        step = parentMap.get(step.id);
      }
    }

    return {
      reachable: foundGoal,
      shortestPath,
      waveOrder,
      snapshots,
    };
  }

  loadPreset(presetName) {
    this.initEmptyGrid();

    if (presetName === 'default') {
      this.getNode(0, 0).setType('START');
      this.getNode(9, 9).setType('GOAL');

      const walls = [
        [1, 2], [2, 2], [3, 2], [4, 2],
        [6, 1], [6, 2], [6, 3], [6, 4],
        [2, 5], [3, 5], [4, 5], [5, 5],
        [1, 7], [2, 7], [3, 7],
        [7, 6], [8, 6], [7, 7],
      ];
      walls.forEach(([r, c]) => this.getNode(r, c).setType('WALL'));

      const traps = [[4, 3], [2, 6], [7, 4], [8, 8]];
      traps.forEach(([r, c]) => this.getNode(r, c).setType('TRAP'));

      this.getNode(1, 4).setType('BONUS');
      this.getNode(8, 2).setType('BONUS');
      this.getNode(0, 4).setType('BOOST', 'RIGHT');
      this.getNode(5, 2).setType('BOOST', 'DOWN');
    } else if (presetName === 'wormhole') {
      this.getNode(0, 0).setType('START');
      this.getNode(9, 9).setType('GOAL');

      for (let r = 0; r < 10; r++) {
        if (r !== 4) this.getNode(r, 5).setType('WALL');
      }
      this.getNode(4, 5).setType('TRAP');

      this.getNode(2, 2).setType('PORTAL_A');
      this.getNode(7, 7).setType('PORTAL_B');

      this.getNode(1, 8).setType('BONUS');
      this.getNode(8, 2).setType('BONUS');
      this.getNode(6, 7).setType('TRAP');
      this.getNode(8, 7).setType('BOOST', 'RIGHT');
    } else if (presetName === 'conveyor') {
      this.getNode(0, 0).setType('START');
      this.getNode(9, 9).setType('GOAL');

      for (let c = 1; c <= 7; c++) {
        this.getNode(1, c).setType('BOOST', 'RIGHT');
      }
      for (let r = 2; r <= 7; r++) {
        this.getNode(r, 8).setType('BOOST', 'DOWN');
      }

      const walls = [
        [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
        [4, 3], [5, 3], [6, 3], [7, 3],
        [4, 6], [5, 6], [6, 6],
      ];
      walls.forEach(([r, c]) => this.getNode(r, c).setType('WALL'));

      this.getNode(3, 7).setType('TRAP');
      this.getNode(6, 7).setType('TRAP');
      this.getNode(8, 4).setType('BONUS');
      this.getNode(5, 1).setType('BONUS');
    }

    this.rebuildEdges(false);
  }

  randomizeSafeMaze() {
    let attempts = 0;
    while (attempts < 40) {
      attempts++;
      this.initEmptyGrid();
      this.getNode(0, 0).setType('START');
      this.getNode(9, 9).setType('GOAL');

      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          if ((r === 0 && c === 0) || (r === 9 && c === 9)) continue;
          const roll = Math.random();
          if (roll < 0.21) {
            this.getNode(r, c).setType('WALL');
          } else if (roll < 0.27) {
            this.getNode(r, c).setType('TRAP');
          } else if (roll < 0.31) {
            this.getNode(r, c).setType('BONUS');
          } else if (roll < 0.35) {
            const bDir = DIRS[Math.floor(Math.random() * DIRS.length)];
            this.getNode(r, c).setType('BOOST', bDir);
          }
        }
      }

      this.getNode(1, 2).setType('PORTAL_A');
      this.getNode(6, 7).setType('PORTAL_B');

      this.rebuildEdges(false);
      const check = this.verifyReachabilityBFS();
      if (check.reachable && check.shortestPath.length >= 6) {
        return check;
      }
    }
    this.loadPreset('default');
    return this.verifyReachabilityBFS();
  }

  exportJSON() {
    const tiles = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const n = this.nodes[r][c];
        tiles.push({
          row: r,
          col: c,
          type: n.type,
          boostDir: n.boostDir,
        });
      }
    }
    return JSON.stringify({ version: 2, size: this.size, tiles }, null, 2);
  }

  importJSON(jsonStr) {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || !Array.isArray(parsed.tiles)) {
      throw new Error('Invalid maze JSON format');
    }
    this.initEmptyGrid();
    for (const item of parsed.tiles) {
      const node = this.getNode(item.row, item.col);
      if (node && item.type) {
        node.setType(item.type, item.boostDir || 'RIGHT');
      }
    }
    if (!this.findFirstNodeOfType('START')) this.getNode(0, 0).setType('START');
    if (!this.findFirstNodeOfType('GOAL')) this.getNode(9, 9).setType('GOAL');
    this.rebuildEdges(false);
  }
}

// ============================================================================
// 6. POINTER CODE VIEWER SNIPPETS (CLEAN CLASSROOM VERSION)
// ============================================================================

const DSA_CODE_SNIPPETS = {
  ring: `// 01. CIRCULAR QUEUE (10-Slot Fixed Ring Buffer)
class CircularQueue {
  constructor(capacity = 10) {
    this.capacity = capacity;
    this.buffer = new Array(capacity).fill(null);
    this.front = 0; // Oldest slot index
    this.rear = 0;  // Next write slot index
    this.count = 0;
  }

  // O(1) Enqueue with Modulo Wrap-Around
  enqueue(transition) {
    const isFull = this.count === this.capacity;
    this.buffer[this.rear] = transition;

    // Wrap index 9 -> 0 using modulo arithmetic
    this.rear = (this.rear + 1) % this.capacity;

    if (isFull) {
      this.front = (this.front + 1) % this.capacity;
    } else {
      this.count++;
    }
  }
}`,

  bfs: `// 02. NORMAL FIFO QUEUE — Level-by-Level Shortest Path Search
class QueueNode {
  constructor(tile) {
    this.tile = tile;
    this.next = null;
  }
}

class LinkedQueue {
  constructor() {
    this.front = null;
    this.rear = null;
  }

  // Add new tile at REAR
  enqueue(tile) {
    const node = new QueueNode(tile);
    if (!this.rear) {
      this.front = this.rear = node;
    } else {
      this.rear.next = node;
      this.rear = node;
    }
  }

  // Remove oldest tile from FRONT (First-In, First-Out)
  dequeue() {
    if (!this.front) return null;
    const removed = this.front;
    this.front = this.front.next;
    if (!this.front) this.rear = null;
    return removed.tile;
  }
}`,

  stack: `// 03. LINKED LIST STACK (LIFO) — Backward Score Update
class StackNode {
  constructor(tile, moveEdge, reward, stepIndex) {
    this.node = tile;
    this.edge = moveEdge;
    this.reward = reward;
    this.stepIndex = stepIndex;
    this.next = null; // Pointer to previous step below
  }
}

class TrajectoryStack {
  constructor() {
    this.top = null;
    this.size = 0;
  }

  // O(1) Push onto TOP when rover steps forward
  push(tile, moveEdge, reward, stepIndex) {
    const frame = new StackNode(tile, moveEdge, reward, stepIndex);
    frame.next = this.top;
    this.top = frame;
    this.size++;
  }

  // O(1) Pop from TOP when rover traces backward to Start
  pop() {
    if (this.top === null) return null;
    const popped = this.top;
    this.top = this.top.next;
    popped.next = null;
    this.size--;
    return popped;
  }
}`,

  graph: `// 04. SINGLY LINKED LIST — Valid Neighbor Moves Per Tile
class MoveEdgeNode {
  constructor(direction, targetTile, entryTile) {
    this.direction = direction;   // "UP" | "RIGHT" | "DOWN" | "LEFT"
    this.targetNode = targetTile; // Destination tile pointer
    this.entryNode = entryTile;   // Immediate neighbor tile pointer
    this.weight = 0.0;            // Learned move score Q(s, a)
    this.next = null;             // Next valid move in Linked List
  }
}

// Traverse a tile's Singly Linked List to pick the highest-scoring move
function getBestMove(tile) {
  let curr = tile.edgesHead;
  let best = null;
  while (curr !== null) {
    if (best === null || curr.weight > best.weight) {
      best = curr;
    }
    curr = curr.next;
  }
  return best;
}`
};

// ============================================================================
// 7. APPLICATION STATE
// ============================================================================

const graph = new GridGraph(10);
const trajectoryStack = new TrajectoryStack();
const replayBuffer = new CircularBuffer(10);

const appState = {
  design: 'synais', // 'synais' | 'swiss' | 'botanical' | 'editorial'
  theme: 'light', // 'light' | 'dark'
  boardMode: 'INSPECT', // 'INSPECT' | 'EDIT' | 'PLAY'
  activeBrush: 'WALL',
  boostBrushDirIndex: 1, // 0:UP, 1:RIGHT, 2:DOWN, 3:LEFT

  // AI Hyperparameters
  alpha: 0.45,
  gamma: 0.92,
  epsilon: 1.0,
  epsilonDecay: 0.94,
  minEpsilon: 0.04,
  speedPercent: 65,
  useReplayBuffer: true,

  // Visual overlays
  showHeatmap: true,
  showArrows: true,
  showShortestPath: true,

  // Telemetry Metrics
  episodeCount: 0,
  winCount: 0,
  lastReward: 0,
  lastOutcomeText: 'Ready',
  historyWinRates: [],
  historyRewards: [],
  recentOutcomesWindow: [],

  // Rover & Selection State
  selectedNode: null,
  agentNode: null,
  activeTrail: [], // Array of { fromNode, entryNode, toNode, direction, transitionTag }
  poppedNodeHighlight: null,
  hoveredRingSlot: -1,

  // BFS Wavefront Animation State
  bfsCheckResult: null,
  bfsWaveAnimatedNodes: [],
  bfsWaveActive: false,
  bfsActiveSnapshot: null,

  // Episode Runner / Step Debugger State
  isRunningEpisode: false,
  isAutoTraining: false,
  stepDebugMode: false,
  debugPaused: false,
  debugStepResolver: null,
  stopRequested: false,

  // Human Play Mode State
  humanNode: null,
  humanSteps: 0,
  humanScore: 0,
  aiBestScoreBenchmark: null,

  // Canvas Floating Score Popups
  floatingPopups: [],
};

// ============================================================================
// 8. CORE Q-LEARNING, EPSILON-GREEDY & EXACT BELLMAN REWARD PROPAGATION
// ============================================================================

// Compute shortest hop distance to Goal using our LinkedQueue (FIFO Queue)
function getHopDistanceToGoal(fromNode) {
  if (!fromNode || !graph.goalNode) return 20;
  if (fromNode === graph.goalNode) return 0;

  const queue = new LinkedQueue();
  const distMap = new Map([[fromNode.id, 0]]);
  queue.enqueue(fromNode);

  while (!queue.isEmpty()) {
    const curr = queue.dequeue();
    const d = distMap.get(curr.id) || 0;
    if (curr === graph.goalNode) return d;

    let edgePtr = curr.edgesHead;
    while (edgePtr !== null) {
      const next = edgePtr.targetNode;
      if (next.type !== 'TRAP' && !distMap.has(next.id)) {
        distMap.set(next.id, d + 1);
        queue.enqueue(next);
      }
      edgePtr = edgePtr.next;
    }
  }
  return Math.abs(graph.goalNode.row - fromNode.row) + Math.abs(graph.goalNode.col - fromNode.col);
}

/**
 * Robust Epsilon-Greedy Decision Policy:
 * - Filters out discovered Traps (weight <= -15) so the rover never repeats fatal mistakes.
 * - Prevents 2-tile oscillation by avoiding immediate U-turns onto prevNode unless trapped in a dead end.
 * - In EXPLORE mode (prob = epsilon): uses UCB novelty + BFS progress heuristic to explore unvisited corridors.
 * - In EXPLOIT mode (prob = 1 - epsilon, or Best Path): chooses the highest learned Q-value edge,
 *   using episode visit counts to prevent loops and FIFO Queue distance to break 0.0 ties.
 */
function chooseActionEpsilonGreedy(
  node,
  forceGreedy = false,
  visitedCounts = null,
  prevNode = null
) {
  const edges = node.getEdgesArray();
  if (edges.length === 0) return null;

  // 1. If Goal is directly adjacent in the Singly Linked List, always take it!
  const directGoalEdge = edges.find((e) => e.targetNode.type === 'GOAL');
  if (directGoalEdge) {
    return { edge: directGoalEdge, mode: forceGreedy ? 'EXPLOIT' : 'EXPLORE' };
  }

  // 2. Filter out discovered Traps (or obvious Trap tiles once seen)
  const nonTrapEdges = edges.filter(
    (e) => !(e.visits > 0 && e.weight <= -15) && e.targetNode.type !== 'TRAP'
  );
  const safePool = nonTrapEdges.length > 0 ? nonTrapEdges : edges;

  // 3. Avoid immediate 180° U-turn back to prevNode if other safe moves exist
  const forwardPool = prevNode
    ? safePool.filter((e) => e.targetNode !== prevNode)
    : safePool;
  const activePool = forwardPool.length > 0 ? forwardPool : safePool;

  // 4. Epsilon-Greedy Branch: EXPLORE vs EXPLOIT
  const isExploring = !forceGreedy && Math.random() < appState.epsilon;

  if (isExploring) {
    let bestExploreEdge = activePool[0];
    let bestExploreScore = -Infinity;

    for (const edge of activePool) {
      const epVisits = visitedCounts ? visitedCounts.get(edge.targetNode.id) || 0 : 0;
      // UCB novelty bonus strongly favors unvisited edges (visits === 0)
      const noveltyBonus = edge.visits === 0 ? 32 : 16 / Math.sqrt(edge.visits + 1);
      // True tile value awareness (Bonus +25, Goal +100)
      const immediateTileSignal = edge.targetNode.reward * 0.45;
      // Progress toward Goal via FIFO Queue hop count
      const goalDist = getHopDistanceToGoal(edge.targetNode);
      const progressSignal = (20 - goalDist) * 2.2;
      // Strong penalty for re-stepping on tiles already visited in this episode
      const loopPenalty = epVisits * 40;
      const jitter = Math.random() * 4.5;

      const score =
        edge.weight * 0.35 +
        noveltyBonus +
        immediateTileSignal +
        progressSignal -
        loopPenalty +
        jitter;

      if (score > bestExploreScore) {
        bestExploreScore = score;
        bestExploreEdge = edge;
      }
    }
    return { edge: bestExploreEdge, mode: 'EXPLORE' };
  }

  // 5. EXPLOIT / OPTIMAL POLICY: Pick highest learned Q(s, a) with cycle avoidance
  let bestEdge = activePool[0];
  let bestScore = -Infinity;

  for (const edge of activePool) {
    const epVisits = visitedCounts ? visitedCounts.get(edge.targetNode.id) || 0 : 0;
    const cyclePenalty = epVisits * 60;
    const goalDist = getHopDistanceToGoal(edge.targetNode);
    // When edges are unvisited (weight == 0), break ties using true tile reward + shortest path to Goal
    const unvisitedHeuristic =
      edge.visits === 0 ? (20 - goalDist) * 1.5 + edge.targetNode.reward * 0.25 : (20 - goalDist) * 0.05;

    const effectiveScore = edge.weight + unvisitedHeuristic - cyclePenalty;
    if (effectiveScore > bestScore) {
      bestScore = effectiveScore;
      bestEdge = edge;
    }
  }

  return { edge: bestEdge || node.getBestEdge() || edges[0], mode: 'EXPLOIT' };
}

/**
 * Exact Bellman Q-Update:
 * Q(s, a) <- OldQ + alpha * [ R(s, a) + gamma * maxNextQ - OldQ ]
 * Terminal tiles (GOAL / TRAP) have 0 continuation value because the episode ends there
 * and their +100 / -50 reward is delivered immediately upon entering the tile.
 */
function updateEdgeQValue(edge, reward, nextNode, downstreamReturn = null) {
  const oldQ = edge.weight;
  const isTerminal = nextNode.type === 'GOAL' || nextNode.type === 'TRAP';
  const maxNextQ = isTerminal ? 0 : nextNode.getMaxQ();

  // Blend 1-step Bellman maxNextQ with actual trajectory return from LIFO Stack pop
  const backedUpNext =
    !isTerminal && downstreamReturn !== null
      ? Math.max(maxNextQ, downstreamReturn)
      : maxNextQ;

  const tdTarget = reward + appState.gamma * backedUpNext;
  const tdError = tdTarget - oldQ;
  const newQ = oldQ + appState.alpha * tdError;

  edge.weight = Math.round(newQ * 100) / 100;
  edge.visits++;

  return {
    oldQ,
    maxNextQ: backedUpNext,
    tdTarget,
    tdError,
    newQ: edge.weight,
  };
}

/**
 * Multi-Pass Bellman Value Propagation over Visited Graph Edges:
 * Ensures that all visited tiles accurately reflect true discounted tile values
 * (+100 Goal, +25 Bonus, -50 Trap, -1 Empty step) so optimal paths lock in fast.
 */
function propagateBellmanAcrossVisitedGraph(passes = 3) {
  for (let p = 0; p < passes; p++) {
    for (let r = 0; r < graph.size; r++) {
      for (let c = 0; c < graph.size; c++) {
        const node = graph.nodes[r][c];
        if (node.type === 'WALL' || node.type === 'GOAL' || node.type === 'TRAP') continue;

        let edge = node.edgesHead;
        while (edge !== null) {
          if (edge.visits > 0) {
            const target = edge.targetNode;
            const isTerm = target.type === 'GOAL' || target.type === 'TRAP';
            // Prevent Bonus farming loops in value iteration by capping bonus continuation if pointing back
            const nextBestEdge = isTerm ? null : target.getBestEdge();
            const isTwoTileBounce =
              nextBestEdge && nextBestEdge.targetNode === node && target.type === 'BONUS';
            const nextMaxQ = isTerm
              ? 0
              : isTwoTileBounce
              ? Math.max(0, target.getMaxQ() - 26)
              : target.getMaxQ();

            const exactTarget = target.reward + appState.gamma * nextMaxQ;
            edge.weight =
              Math.round((edge.weight + appState.alpha * (exactTarget - edge.weight)) * 100) / 100;
          }
          edge = edge.next;
        }
      }
    }
  }
}

function runReplayMiniBatch() {
  if (!appState.useReplayBuffer || replayBuffer.count === 0) {
    replayBuffer.lastSampledSlots = [];
    return;
  }
  const batch = replayBuffer.sampleBatch(4);
  for (const exp of batch) {
    if (exp && exp.edgeRef && exp.nextNodeRef) {
      updateEdgeQValue(exp.edgeRef, exp.reward, exp.nextNodeRef);
    }
  }
  propagateBellmanAcrossVisitedGraph(2);
}

function recordEpisodeTelemetry(totalReward, reachedGoal) {
  appState.episodeCount++;
  appState.lastReward = Math.round(totalReward * 10) / 10;

  if (reachedGoal) {
    appState.winCount++;
    appState.lastOutcomeText = 'Goal (+100)';
    if (
      appState.aiBestScoreBenchmark === null ||
      appState.lastReward > appState.aiBestScoreBenchmark
    ) {
      appState.aiBestScoreBenchmark = appState.lastReward;
    }
  } else if (totalReward <= -35) {
    appState.lastOutcomeText = 'Trap (-50)';
  } else {
    appState.lastOutcomeText = 'Max Steps';
  }

  appState.recentOutcomesWindow.push(reachedGoal ? 1 : 0);
  if (appState.recentOutcomesWindow.length > 25) {
    appState.recentOutcomesWindow.shift();
  }
  const rollingWinRate =
    (appState.recentOutcomesWindow.reduce((a, b) => a + b, 0) /
      appState.recentOutcomesWindow.length) *
    100;

  appState.historyWinRates.push(rollingWinRate);
  appState.historyRewards.push(appState.lastReward);
  if (appState.historyWinRates.length > 300) {
    appState.historyWinRates.shift();
    appState.historyRewards.shift();
  }

  appState.epsilon = Math.max(
    appState.minEpsilon,
    appState.epsilon * appState.epsilonDecay
  );
}

// Fast headless episode for "Fast 100 Runs"
function runSilentEpisode() {
  if (!graph.startNode) return;
  trajectoryStack.clear();

  let curr = graph.startNode;
  let prevNode = null;
  let totalReward = 0;
  let reachedGoal = false;
  const maxSteps = 38;
  const visitedBonuses = new Set();
  const visitedCounts = new Map([[curr.id, 1]]);

  for (let step = 1; step <= maxSteps; step++) {
    const choice = chooseActionEpsilonGreedy(curr, false, visitedCounts, prevNode);
    if (!choice || !choice.edge) break;

    const edge = choice.edge;
    const nextNode = edge.targetNode;

    let stepReward = nextNode.reward;
    if (nextNode.type === 'BONUS') {
      if (visitedBonuses.has(nextNode.id)) {
        stepReward = -1;
      } else {
        visitedBonuses.add(nextNode.id);
      }
    }

    totalReward += stepReward;
    visitedCounts.set(nextNode.id, (visitedCounts.get(nextNode.id) || 0) + 1);

    trajectoryStack.push(curr, edge, stepReward, step);
    replayBuffer.enqueue(curr, edge, stepReward, nextNode);

    prevNode = curr;
    curr = nextNode;
    if (curr.type === 'GOAL') {
      reachedGoal = true;
      break;
    }
    if (curr.type === 'TRAP') {
      break;
    }
  }

  // Pop LIFO Stack in reverse order and propagate exact trajectory return back to Start
  let downstreamReturn = 0;
  while (!trajectoryStack.isEmpty()) {
    const frame = trajectoryStack.pop();
    if (frame && frame.edge) {
      const math = updateEdgeQValue(
        frame.edge,
        frame.reward,
        frame.edge.targetNode,
        downstreamReturn
      );
      downstreamReturn = math.newQ;
    }
  }

  runReplayMiniBatch();
  recordEpisodeTelemetry(totalReward, reachedGoal);
}

// ============================================================================
// 9. ANIMATED EPISODE RUNNER & STEP DEBUGGER
// ============================================================================

function getStepDelayMs() {
  const s = appState.speedPercent;
  return Math.round(520 - (s / 100) * 485);
}

async function waitStepOrDebugger(delayMs) {
  if (appState.stopRequested) return;
  if (appState.stepDebugMode && appState.debugPaused) {
    updateDebuggerUI();
    await new Promise((resolve) => {
      appState.debugStepResolver = resolve;
    });
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function startAnimatedEpisode({ isOptimalRun = false, startPaused = false } = {}) {
  if (appState.isRunningEpisode) return;
  if (!graph.startNode) return;

  const bfsCheck = graph.verifyReachabilityBFS();
  appState.bfsCheckResult = bfsCheck;
  if (!bfsCheck.reachable) {
    showToast('Goal is blocked by Walls! Clear a path or click Random.', 'warn');
  }

  appState.isRunningEpisode = true;
  appState.stopRequested = false;
  appState.stepDebugMode = startPaused;
  appState.debugPaused = startPaused;
  appState.bfsWaveActive = false;
  appState.bfsActiveSnapshot = null;

  trajectoryStack.clear();
  appState.activeTrail = [];
  appState.poppedNodeHighlight = null;

  let curr = graph.startNode;
  let prevNode = null;
  appState.agentNode = curr;
  appState.selectedNode = curr;

  let totalReward = 0;
  let reachedGoal = false;
  const maxSteps = 36;
  const visitedBonuses = new Set();
  const visitedCounts = new Map([[curr.id, 1]]);

  updateDebuggerUI();
  setPhaseBanner(
    isOptimalRun
      ? 'BEST PATH · FOLLOWING HIGHEST LINKED LIST SCORES'
      : 'PHASE 1 · PUSHING STEPS ONTO LIFO STACK',
    'STACK PUSH'
  );
  renderAllPanels();

  // ---------------- PHASE 1: FORWARD WALK (PUSH ONTO STACK) ----------------
  for (let step = 1; step <= maxSteps; step++) {
    if (appState.stopRequested) break;

    const choice = chooseActionEpsilonGreedy(curr, isOptimalRun, visitedCounts, prevNode);
    if (!choice || !choice.edge) break;

    const { edge, mode } = choice;
    const nextNode = edge.targetNode;

    let stepReward = nextNode.reward;
    if (nextNode.type === 'BONUS') {
      if (visitedBonuses.has(nextNode.id)) {
        stepReward = -1;
      } else {
        visitedBonuses.add(nextNode.id);
      }
    }

    totalReward += stepReward;
    visitedCounts.set(nextNode.id, (visitedCounts.get(nextNode.id) || 0) + 1);

    // 1. Push onto Linked List Stack (LIFO)
    trajectoryStack.push(curr, edge, stepReward, step);

    // 2. Enqueue into 10-Slot Circular Queue
    replayBuffer.enqueue(curr, edge, stepReward, nextNode);

    // 3. Record trail segment including immediate entryNode so Portals/Boosts never draw false diagonal lines
    appState.activeTrail.push({
      fromNode: curr,
      entryNode: edge.entryNode || nextNode,
      toNode: nextNode,
      direction: edge.direction,
      transitionTag: edge.transitionTag || 'NORMAL',
    });

    appState.agentNode = nextNode;
    appState.selectedNode = curr;

    if (stepReward >= 20 || stepReward <= -20) {
      spawnCanvasPopup(
        nextNode.row,
        nextNode.col,
        stepReward > 0 ? `+${stepReward}` : `${stepReward}`,
        stepReward > 0 ? '#1c6b47' : '#b42318'
      );
    }

    updateLiveExplanationBox({
      phase: 'FORWARD',
      step,
      fromNode: curr,
      toNode: nextNode,
      edge,
      mode,
      stepReward,
    });

    setStackStatusBanner(
      `PUSH (${curr.row},${curr.col}) ${DIR_ARROWS[edge.direction]}`,
      `DEPTH: ${trajectoryStack.size}`
    );

    renderAllPanels();
    await waitStepOrDebugger(getStepDelayMs());

    prevNode = curr;
    curr = nextNode;
    if (curr.type === 'GOAL') {
      reachedGoal = true;
      break;
    }
    if (curr.type === 'TRAP') {
      break;
    }
  }

  // ---------------- PHASE 2: BACKWARD SCORE UPDATE (POP FROM LIFO STACK) ----------------
  if (!appState.stopRequested) {
    setPhaseBanner(
      'PHASE 2 · POPPING STACK (LIFO) & TRACING ROVER BACKWARD',
      'STACK POP'
    );

    let downstreamReturn = 0;
    while (!trajectoryStack.isEmpty() && !appState.stopRequested) {
      const popped = trajectoryStack.pop();
      if (!popped || !popped.edge) continue;

      const math = updateEdgeQValue(
        popped.edge,
        popped.reward,
        popped.edge.targetNode,
        downstreamReturn
      );
      downstreamReturn = math.newQ;

      popped.oldQ = math.oldQ;
      popped.newQ = math.newQ;
      popped.tdError = math.tdError;

      // Move both the trail AND the big rover circle backward to the popped tile!
      appState.agentNode = popped.node;
      appState.poppedNodeHighlight = popped.node;
      appState.selectedNode = popped.node;
      appState.activeTrail.pop();

      const deltaStr =
        math.newQ - math.oldQ >= 0
          ? `+${(math.newQ - math.oldQ).toFixed(1)}`
          : (math.newQ - math.oldQ).toFixed(1);

      spawnCanvasPopup(
        popped.node.row,
        popped.node.col,
        deltaStr,
        math.newQ >= math.oldQ ? '#1c6b47' : '#b86814'
      );

      updateLiveExplanationBox({
        phase: 'BACKPROP',
        popped,
        math,
      });

      setStackStatusBanner(
        `POP (${popped.node.row},${popped.node.col}) → ${math.newQ.toFixed(1)}`,
        `LEFT: ${trajectoryStack.size}`
      );

      renderAllPanels();
      await waitStepOrDebugger(Math.max(45, Math.round(getStepDelayMs() * 0.72)));
    }
  }

  // ---------------- PHASE 3: SAMPLE CIRCULAR QUEUE & FINISH ----------------
  if (!appState.stopRequested) {
    appState.agentNode = graph.startNode;
    runReplayMiniBatch();
    recordEpisodeTelemetry(totalReward, reachedGoal);
  }

  appState.poppedNodeHighlight = null;
  appState.isRunningEpisode = false;
  appState.stepDebugMode = false;
  appState.debugPaused = false;
  updateDebuggerUI();

  setStackStatusBanner('TOP → NULL (EMPTY)', 'COMPLETE');
  setPhaseBanner(
    reachedGoal
      ? `RUN #${appState.episodeCount} WON · ROVER RETURNED TO START`
      : `RUN #${appState.episodeCount} FINISHED · SCORES UPDATED`,
    'READY'
  );

  renderAllPanels();

  if (appState.isAutoTraining && !appState.stopRequested) {
    setTimeout(() => {
      if (appState.isAutoTraining && !appState.isRunningEpisode) {
        startAnimatedEpisode({ isOptimalRun: false, startPaused: false });
      }
    }, 90);
  }
}

// ============================================================================
// 10. ANIMATED FIFO QUEUE (BFS) WAVEFRONT VISUALIZER
// ============================================================================

async function animateBFSWavefront() {
  if (appState.isRunningEpisode) return;

  const bfs = graph.verifyReachabilityBFS();
  appState.bfsCheckResult = bfs;
  appState.bfsWaveAnimatedNodes = [];
  appState.bfsWaveActive = true;

  setPhaseBanner(
    'FIFO QUEUE SEARCH · LEVEL-BY-LEVEL SHORTEST PATH CHECK',
    'QUEUE BFS'
  );

  for (let i = 0; i < bfs.snapshots.length; i++) {
    const snap = bfs.snapshots[i];
    appState.bfsWaveAnimatedNodes.push(snap.dequeuedNode);
    appState.bfsActiveSnapshot = snap;
    renderBFSQueueCardUI();
    drawArena();
    await new Promise((r) => setTimeout(r, 28));
  }

  appState.bfsActiveSnapshot = null;
  if (bfs.reachable) {
    setPhaseBanner(
      `QUEUE VERIFIED · SHORTEST PATH IS ${bfs.shortestPath.length - 1} STEPS`,
      'PATH OPEN'
    );
  } else {
    setPhaseBanner(
      'QUEUE EMPTY · GOAL IS BLOCKED BY WALLS',
      'BLOCKED'
    );
  }

  renderAllPanels();
  setTimeout(() => {
    appState.bfsWaveActive = false;
    drawArena();
  }, 1600);
}

// ============================================================================
// 11. 10x10 CANVAS RENDERER (CRISP ARCHITECTURAL PALETTE + ORTHOGONAL TRAILS)
// ============================================================================

const gridCanvas = document.getElementById('gridCanvas');
const ctx = gridCanvas.getContext('2d');

function spawnCanvasPopup(row, col, text, color) {
  appState.floatingPopups.push({
    row,
    col,
    text,
    color,
    alpha: 1.0,
    offsetY: 0,
  });
}

function getCanvasPalette() {
  const isDark = appState.theme === 'dark';

  // Tactile Hardware & Spatial Bento Palette (Studio Light vs Carbon Dark)
  return {
    isDark,
    boardBg: isDark ? '#121215' : '#ffffff',
    gutterBg: isDark ? '#1a1a1f' : '#f4f4f1',
    gridLine: isDark ? '#26262c' : '#e2e2dd',
    coordText: isDark ? '#a1a1aa' : '#52524e',
    wallFill: isDark ? '#202026' : '#e0e0da',
    wallHatch: isDark ? '#34343e' : '#b8b8b0',
    textMain: isDark ? '#f4f4f6' : '#141413',
    textMuted: isDark ? '#a1a1aa' : '#52524e',
    terracotta: isDark ? '#ff5e1a' : '#ff4f00',
    moss: isDark ? '#10b981' : '#059669',
    ochre: isDark ? '#f59e0b' : '#d97706',
    plum: isDark ? '#a78bfa' : '#6d28d9',
    crimson: isDark ? '#f43f5e' : '#dc2626',
  };
}

function drawArena() {
  if (!gridCanvas) return;
  const rect = gridCanvas.parentElement.getBoundingClientRect();
  const sizePx = Math.max(260, Math.floor(rect.width));
  const dpr = window.devicePixelRatio || 1;

  if (gridCanvas.width !== sizePx * dpr || gridCanvas.height !== sizePx * dpr) {
    gridCanvas.width = sizePx * dpr;
    gridCanvas.height = sizePx * dpr;
    gridCanvas.style.width = `${sizePx}px`;
    gridCanvas.style.height = `${sizePx}px`;
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  const pal = getCanvasPalette();
  ctx.fillStyle = pal.boardBg;
  ctx.fillRect(0, 0, sizePx, sizePx);

  const gutter = 24;
  const boardPx = sizePx - gutter;
  const cell = boardPx / 10;

  // Coordinate ruler gutters
  ctx.fillStyle = pal.gutterBg;
  ctx.fillRect(0, 0, sizePx, gutter);
  ctx.fillRect(0, 0, gutter, sizePx);

  ctx.font = '700 11px "JetBrains Mono", monospace';
  ctx.fillStyle = pal.coordText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < 10; i++) {
    ctx.fillText(`${i}`, gutter + i * cell + cell / 2, gutter / 2);
    ctx.fillText(`${i}`, gutter / 2, gutter + i * cell + cell / 2);
  }

  // Draw 10x10 Tiles
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const node = graph.getNode(r, c);
      const x = gutter + c * cell;
      const y = gutter + r * cell;

      // 1. Learned Score Heatmap Tint
      if (appState.showHeatmap && node.type === 'EMPTY') {
        const maxQ = node.getMaxQ();
        if (Math.abs(maxQ) > 0.5) {
          if (maxQ > 0) {
            const alpha = Math.min(0.28, (maxQ / 100) * 0.28);
            ctx.fillStyle = `rgba(28, 107, 71, ${alpha})`;
          } else {
            const alpha = Math.min(0.25, (Math.abs(maxQ) / 50) * 0.25);
            ctx.fillStyle = `rgba(180, 35, 24, ${alpha})`;
          }
          ctx.fillRect(x, y, cell, cell);
        }
      }

      // 2. Tile Type Styling
      if (node.type === 'WALL') {
        ctx.fillStyle = pal.wallFill;
        ctx.fillRect(x, y, cell, cell);

        // Crisp architectural diagonal hatching
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell, cell);
        ctx.clip();
        ctx.strokeStyle = pal.wallHatch;
        ctx.lineWidth = 1.25;
        for (let d = -cell; d < cell * 2; d += 7) {
          ctx.beginPath();
          ctx.moveTo(x + d, y);
          ctx.lineTo(x + d + cell, y + cell);
          ctx.stroke();
        }
        ctx.restore();
      } else if (node.type === 'START') {
        ctx.fillStyle = pal.isDark ? '#e06d53' : '#1b1815';
        ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(cell * 0.4)}px "JetBrains Mono", monospace`;
        ctx.fillText('S', x + cell / 2, y + cell / 2 + 1);
      } else if (node.type === 'GOAL') {
        ctx.fillStyle = pal.moss;
        ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.round(cell * 0.36)}px "JetBrains Mono", monospace`;
        ctx.fillText('G', x + cell / 2, y + cell * 0.4);
        ctx.font = `700 ${Math.max(9, Math.round(cell * 0.21))}px "JetBrains Mono", monospace`;
        ctx.fillText('+100', x + cell / 2, y + cell * 0.74);
      } else if (node.type === 'TRAP') {
        ctx.fillStyle = pal.isDark ? 'rgba(240,82,82,0.18)' : '#fbeae8';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

        const cx = x + cell / 2;
        const cy = y + cell * 0.42;
        const rad = cell * 0.21;
        ctx.strokeStyle = pal.crimson;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx - rad * 0.55, cy - rad * 0.55);
        ctx.lineTo(cx + rad * 0.55, cy + rad * 0.55);
        ctx.moveTo(cx + rad * 0.55, cy - rad * 0.55);
        ctx.lineTo(cx - rad * 0.55, cy + rad * 0.55);
        ctx.stroke();

        ctx.fillStyle = pal.crimson;
        ctx.font = `700 ${Math.max(9, Math.round(cell * 0.21))}px "JetBrains Mono", monospace`;
        ctx.fillText('-50', cx, y + cell * 0.8);
      } else if (node.type === 'BONUS') {
        ctx.fillStyle = pal.isDark ? 'rgba(232,146,56,0.18)' : '#fdf3e3';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

        const cx = x + cell / 2;
        const cy = y + cell * 0.4;
        const rDia = cell * 0.19;
        ctx.strokeStyle = pal.ochre;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(cx, cy - rDia);
        ctx.lineTo(cx + rDia, cy);
        ctx.lineTo(cx, cy + rDia);
        ctx.lineTo(cx - rDia, cy);
        ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = pal.ochre;
        ctx.font = `700 ${Math.max(9, Math.round(cell * 0.21))}px "JetBrains Mono", monospace`;
        ctx.fillText('+25', cx, y + cell * 0.8);
      } else if (node.type === 'BOOST') {
        ctx.fillStyle = pal.isDark ? 'rgba(232,146,56,0.12)' : '#f7ecdc';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.fillStyle = pal.ochre;
        ctx.font = `800 ${Math.round(cell * 0.44)}px "JetBrains Mono", monospace`;
        ctx.fillText(DIR_ARROWS[node.boostDir || 'RIGHT'], x + cell / 2, y + cell / 2);
      } else if (node.type === 'PORTAL_A' || node.type === 'PORTAL_B') {
        ctx.fillStyle = pal.isDark ? 'rgba(167,139,250,0.18)' : '#efeaf6';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

        ctx.strokeStyle = pal.plum;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, cell * 0.34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = pal.plum;
        ctx.font = `800 ${Math.round(cell * 0.35)}px "JetBrains Mono", monospace`;
        ctx.fillText(node.type === 'PORTAL_A' ? 'A' : 'B', x + cell / 2, y + cell / 2 + 1);
      }

      // 3. Best Direction Arrow Overlay
      if (appState.showArrows && node.type === 'EMPTY') {
        const bestEdge = node.getBestEdge();
        if (bestEdge && Math.abs(bestEdge.weight) > 0.2) {
          ctx.fillStyle = bestEdge.weight > 0 ? pal.moss : pal.coordText;
          ctx.font = `700 ${Math.round(cell * 0.36)}px "JetBrains Mono", monospace`;
          ctx.fillText(DIR_ARROWS[bestEdge.direction], x + cell / 2, y + cell / 2);
        }
      }

      // 4. FIFO Queue Wavefront Highlight
      if (appState.bfsWaveActive && appState.bfsWaveAnimatedNodes.includes(node)) {
        ctx.strokeStyle = pal.moss;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
      }

      // 5. Cell Grid Border
      ctx.strokeStyle = pal.gridLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cell, cell);
    }
  }

  // 6. Subtle Dashed Connector Between Portal A & Portal B
  const pA = graph.findFirstNodeOfType('PORTAL_A');
  const pB = graph.findFirstNodeOfType('PORTAL_B');
  if (pA && pB) {
    ctx.save();
    ctx.strokeStyle = pal.plum;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(gutter + pA.col * cell + cell / 2, gutter + pA.row * cell + cell / 2);
    ctx.lineTo(gutter + pB.col * cell + cell / 2, gutter + pB.row * cell + cell / 2);
    ctx.stroke();
    ctx.restore();
  }

  // 7. FIFO Queue Shortest Path Overlay (Respecting Orthogonal Moves & Portal Teleports)
  if (
    appState.showShortestPath &&
    appState.bfsCheckResult &&
    appState.bfsCheckResult.reachable &&
    appState.bfsCheckResult.shortestPath.length > 1
  ) {
    const path = appState.bfsCheckResult.shortestPath;
    ctx.save();
    ctx.strokeStyle = pal.ochre;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];

      // Find which linked list edge connects a -> b
      let matchingEdge = null;
      let currEdge = a.edgesHead;
      while (currEdge !== null) {
        if (currEdge.targetNode === b) {
          matchingEdge = currEdge;
          break;
        }
        currEdge = currEdge.next;
      }

      const ax = gutter + a.col * cell + cell / 2;
      const ay = gutter + a.row * cell + cell / 2;
      const bx = gutter + b.col * cell + cell / 2;
      const by = gutter + b.row * cell + cell / 2;

      if (matchingEdge && matchingEdge.transitionTag === 'PORTAL_WARP') {
        // Draw only into the portal entrance so we never slash diagonally across walls
        const entry = matchingEdge.entryNode || b;
        const ex = gutter + entry.col * cell + cell / 2;
        const ey = gutter + entry.row * cell + cell / 2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      } else if (matchingEdge && matchingEdge.transitionTag === 'BOOST_SLIDE') {
        // Draw orthogonal elbow through the boost tile
        const entry = matchingEdge.entryNode || b;
        const ex = gutter + entry.col * cell + cell / 2;
        const ey = gutter + entry.row * cell + cell / 2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ex, ey);
        ctx.lineTo(bx, by);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 8. Active Stack Trajectory Trail (Orthogonal Segments; Breaks Cleanly on Portal Warps)
  if (appState.activeTrail.length > 0) {
    ctx.save();
    ctx.strokeStyle = pal.moss;
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const seg of appState.activeTrail) {
      const fx = gutter + seg.fromNode.col * cell + cell / 2;
      const fy = gutter + seg.fromNode.row * cell + cell / 2;
      const entry = seg.entryNode || seg.toNode;
      const ex = gutter + entry.col * cell + cell / 2;
      const ey = gutter + entry.row * cell + cell / 2;
      const tx = gutter + seg.toNode.col * cell + cell / 2;
      const ty = gutter + seg.toNode.row * cell + cell / 2;

      if (seg.transitionTag === 'PORTAL_WARP') {
        // Step into portal entrance, then draw a warp ring on exit portal instead of a wall-cutting line
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        ctx.save();
        ctx.strokeStyle = pal.plum;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tx, ty, cell * 0.24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (seg.transitionTag === 'BOOST_SLIDE') {
        // Draw orthogonal elbow from tile -> boost pad -> slide landing tile
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(ex, ey);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 9. Stack Pop Highlight Ring
  if (appState.poppedNodeHighlight) {
    const pn = appState.poppedNodeHighlight;
    const px = gutter + pn.col * cell;
    const py = gutter + pn.row * cell;
    ctx.strokeStyle = pal.ochre;
    ctx.lineWidth = 3;
    ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
  }

  // 10. Selected / Inspected Tile Reticle
  if (appState.selectedNode) {
    const sn = appState.selectedNode;
    const sx = gutter + sn.col * cell;
    const sy = gutter + sn.row * cell;
    ctx.strokeStyle = pal.terracotta;
    ctx.lineWidth = 2.4;
    ctx.strokeRect(sx + 1.5, sy + 1.5, cell - 3, cell - 3);
  }

  // 11. Active Rover Token (Moves forward on PUSH and traces backward on POP)
  const activeAgent =
    appState.boardMode === 'PLAY' && appState.humanNode
      ? appState.humanNode
      : appState.agentNode || graph.startNode;

  if (activeAgent) {
    const ax = gutter + activeAgent.col * cell + cell / 2;
    const ay = gutter + activeAgent.row * cell + cell / 2;

    ctx.fillStyle = appState.boardMode === 'PLAY' ? pal.ochre : pal.terracotta;
    ctx.beginPath();
    ctx.arc(ax, ay, cell * 0.29, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ax, ay, cell * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // 12. Floating Score Popups
  for (let i = appState.floatingPopups.length - 1; i >= 0; i--) {
    const pop = appState.floatingPopups[i];
    const px = gutter + pop.col * cell + cell / 2;
    const py = gutter + pop.row * cell + cell / 2 - pop.offsetY;

    ctx.save();
    ctx.globalAlpha = pop.alpha;
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.fillStyle = pop.color;
    ctx.fillText(pop.text, px, py);
    ctx.restore();

    pop.offsetY += 0.65;
    pop.alpha -= 0.035;
    if (pop.alpha <= 0) {
      appState.floatingPopups.splice(i, 1);
    }
  }

  ctx.restore();

  if (appState.floatingPopups.length > 0) {
    requestAnimationFrame(drawArena);
  }
}

// ============================================================================
// 12. UI RENDERERS FOR THE 4 DATA STRUCTURES (ZERO LAYOUT SHIFT / CLS = 0)
// ============================================================================

function renderAllPanels() {
  renderTelemetryHeader();
  renderTrajectoryStackUI();
  renderCircularQueueUI();
  renderBFSQueueCardUI();
  renderGraphInspectorUI();
  renderLearningCurve();
  drawArena();
}

function renderTelemetryHeader() {
  document.getElementById('statEpisode').textContent = `${appState.episodeCount}`;
  document.getElementById('statEpsilon').textContent = `${Math.round(
    appState.epsilon * 100
  )}%`;

  const rewardEl = document.getElementById('statReward');
  rewardEl.textContent =
    appState.lastReward > 0 ? `+${appState.lastReward}` : `${appState.lastReward}`;

  document.getElementById('statOutcome').textContent = appState.lastOutcomeText;

  const overallRate =
    appState.episodeCount > 0
      ? ((appState.winCount / appState.episodeCount) * 100).toFixed(1)
      : '0.0';
  document.getElementById('statWinRate').textContent = `${overallRate}%`;
  document.getElementById(
    'statWinCount'
  ).textContent = `${appState.winCount} / ${appState.episodeCount} wins`;

  // Reachability badge
  const bfs = appState.bfsCheckResult || graph.verifyReachabilityBFS();
  appState.bfsCheckResult = bfs;
  const badge = document.getElementById('reachabilityBadge');
  if (bfs.reachable) {
    badge.className =
      'px-3 py-1 rounded-md text-xs font-mono-code font-semibold bg-[var(--accent-moss-soft)] text-[var(--accent-moss)] shrink-0';
    badge.textContent = `✓ Path (${bfs.shortestPath.length - 1} steps)`;
  } else {
    badge.className =
      'px-3 py-1 rounded-md text-xs font-mono-code font-semibold bg-[var(--accent-crimson-soft)] text-[var(--accent-crimson)] shrink-0';
    badge.textContent = '✕ Goal Blocked';
  }

  const aiBenchEl = document.getElementById('aiBenchmarkVal');
  if (aiBenchEl) {
    aiBenchEl.textContent =
      appState.aiBestScoreBenchmark !== null
        ? `${appState.aiBestScoreBenchmark}`
        : '—';
  }
}

function setPhaseBanner(text, badgeText) {
  const pt = document.getElementById('phaseText');
  const pb = document.getElementById('phaseStepBadge');
  if (pt) pt.textContent = text;
  if (pb && badgeText) pb.textContent = badgeText;
}

function setStackStatusBanner(leftText, rightBadge) {
  const box = document.getElementById('stackOperationStatus');
  if (!box) return;
  box.innerHTML = `
    <span class="truncate">${leftText}</span>
    <span class="font-bold text-[var(--accent-terracotta)] shrink-0">${rightBadge}</span>
  `;
}

function updateLiveExplanationBox(info) {
  const mathBox = document.getElementById('liveMathBox');
  const storyBox = document.getElementById('plainEnglishStory');
  if (!mathBox || !storyBox) return;

  if (info.phase === 'FORWARD') {
    const { step, fromNode, toNode, edge, mode, stepReward } = info;
    mathBox.textContent = `PUSH #${step}: (${fromNode.row},${fromNode.col}) ${DIR_ARROWS[edge.direction]} (${toNode.row},${toNode.col}) | R = ${stepReward}`;
    storyBox.textContent =
      mode === 'EXPLORE'
        ? `Random Explore move pushed onto TOP of Stack.`
        : `Best Known move (score ${edge.weight.toFixed(1)}) pushed onto TOP of Stack.`;
  } else if (info.phase === 'BACKPROP') {
    const { popped, math } = info;
    mathBox.textContent = `POP #${popped.stepIndex}: (${popped.node.row},${popped.node.col}) ${DIR_ARROWS[popped.edge.direction]} | ${math.oldQ.toFixed(1)} → ${math.newQ.toFixed(1)}`;
    storyBox.textContent = `Rover stepped back to (${popped.node.row},${popped.node.col}) and updated its score.`;
  }
}

// 03. LINKED LIST STACK UI (Renders inside fixed 196px .stack-scroll-viewport)
function renderTrajectoryStackUI() {
  const container = document.getElementById('stackContainer');
  const badge = document.getElementById('stackSizeBadge');
  if (!container || !badge) return;

  badge.textContent = `DEPTH: ${trajectoryStack.size}`;
  const frames = trajectoryStack.toArray();

  if (frames.length === 0) {
    container.innerHTML = `
      <div class="p-3 arch-well font-mono-code text-xs text-[var(--text-secondary)]">
        <div class="font-bold text-[var(--text-primary)] mb-0.5">TOP → NULL (Stack Empty)</div>
        <div>Click <strong>"Watch 1 Run"</strong> or <strong>"Step Debug"</strong> to watch steps push onto TOP and pop in reverse order.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = frames
    .slice(0, 14)
    .map((f, idx) => {
      const isTop = idx === 0;
      const nextLabel = f.next ? `(${f.next.node.row},${f.next.node.col})` : 'NULL';
      return `
        <div class="px-2.5 py-1.5 rounded-lg border font-mono-code text-xs flex items-center justify-between gap-2 shrink-0 ${
          isTop
            ? 'border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-soft)]'
            : 'border-[var(--border-line)] bg-[var(--bg-well)]'
        }">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="px-1.5 py-0.5 rounded text-[11px] font-bold shrink-0 ${
              isTop
                ? 'bg-[var(--accent-terracotta)] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-secondary)]'
            }">${isTop ? 'TOP' : `#${f.stepIndex}`}</span>
            <span class="font-bold truncate">(${f.node.row},${f.node.col}) ${DIR_ARROWS[f.edge.direction]}</span>
          </div>
          <div class="flex items-center gap-2 text-[11px] shrink-0">
            <span class="${
              f.reward >= 0 ? 'text-[var(--accent-moss)]' : 'text-[var(--accent-crimson)]'
            } font-bold">${f.reward >= 0 ? `+${f.reward}` : f.reward}</span>
            <span class="text-[var(--text-secondary)]">.next→${nextLabel}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

// 01. CIRCULAR QUEUE UI (Interactive SVG Ring Wheel + 10 Fixed-Height Slot Cards)
function renderCircularQueueUI() {
  document.getElementById('ringHeadVal').textContent = `${replayBuffer.head}`;
  document.getElementById('ringTailVal').textContent = `${replayBuffer.tail}`;
  document.getElementById(
    'ringCountVal'
  ).textContent = `${replayBuffer.count}/${replayBuffer.capacity}`;

  renderRingWheelSVG();

  const grid = document.getElementById('ringBufferGrid');
  if (!grid) return;

  let html = '';
  for (let i = 0; i < replayBuffer.capacity; i++) {
    const item = replayBuffer.buffer[i];
    const isFront = i === replayBuffer.head && replayBuffer.count > 0;
    const isRear = i === replayBuffer.tail;
    const isHovered = i === appState.hoveredRingSlot;

    let borderClass = 'border-[var(--border-line)] bg-[var(--bg-well)]';
    if (isHovered || isRear) {
      borderClass =
        'border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-soft)]';
    } else if (isFront) {
      borderClass = 'border-[var(--accent-ochre)] bg-[var(--accent-ochre-soft)]';
    }

    const badges = [];
    if (isFront) badges.push('<span class="text-[var(--accent-ochre)] font-bold">F</span>');
    if (isRear) badges.push('<span class="text-[var(--accent-terracotta)] font-bold">R</span>');

    if (item) {
      html += `
        <div data-ringslot="${i}" class="ring-slot-card px-2 py-1.5 rounded-lg border font-mono-code text-xs transition-colors cursor-pointer ${borderClass}">
          <div class="flex items-center justify-between leading-none">
            <span class="font-bold text-[var(--text-secondary)]">[${i}]</span>
            <span class="flex items-center gap-0.5 text-[11px]">${badges.join('')}</span>
          </div>
          <div class="font-bold text-[var(--text-primary)] whitespace-nowrap leading-tight">
            (${item.row},${item.col}) ${DIR_ARROWS[item.direction]}
          </div>
          <div class="flex items-center justify-between text-[11px] leading-none">
            <span class="${
              item.reward >= 0 ? 'text-[var(--accent-moss)]' : 'text-[var(--accent-crimson)]'
            } font-bold">${item.reward >= 0 ? `+${item.reward}` : item.reward}</span>
            <span class="text-[var(--text-secondary)]">#${item.stepStamp}</span>
          </div>
        </div>
      `;
    } else {
      html += `
        <div data-ringslot="${i}" class="ring-slot-card px-2 py-1.5 rounded-lg border font-mono-code text-xs opacity-65 ${borderClass}">
          <div class="flex items-center justify-between leading-none">
            <span class="font-bold text-[var(--text-secondary)]">[${i}]</span>
            <span class="text-[11px]">${badges.join('')}</span>
          </div>
          <div class="text-[var(--text-muted)] font-semibold leading-tight">EMPTY</div>
          <div class="text-[11px] text-[var(--text-muted)] leading-none">slot ${i}</div>
        </div>
      `;
    }
  }

  grid.innerHTML = html;

  grid.querySelectorAll('[data-ringslot]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      appState.hoveredRingSlot = Number(el.getAttribute('data-ringslot'));
      renderRingWheelSVG();
    });
    el.addEventListener('mouseleave', () => {
      appState.hoveredRingSlot = -1;
      renderRingWheelSVG();
    });
  });
}

function renderRingWheelSVG() {
  const svg = document.getElementById('ringWheelSvg');
  if (!svg) return;

  const isDark = appState.theme === 'dark';
  const cx = 100;
  const cy = 100;
  const outerR = 84;
  const innerR = 48;
  const n = 10;

  let paths = '';

  for (let i = 0; i < n; i++) {
    const startAngle = (i * 36 - 90 - 16) * (Math.PI / 180);
    const endAngle = (i * 36 - 90 + 16) * (Math.PI / 180);

    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);

    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);

    const item = replayBuffer.buffer[i];
    const isFront = i === replayBuffer.head && replayBuffer.count > 0;
    const isRear = i === replayBuffer.tail;
    const isHovered = i === appState.hoveredRingSlot;

    let fill = isDark ? '#1a1a1f' : '#ebebe6';
    let stroke = isDark ? '#2e2e36' : '#d4d4ce';

    if (item) {
      fill = isDark ? '#26262f' : '#dfdfd8';
    }
    if (isFront) {
      fill = isDark ? 'rgba(245,158,11,0.28)' : '#fef3c7';
      stroke = isDark ? '#f59e0b' : '#d97706';
    }
    if (isRear || isHovered) {
      fill = isDark ? 'rgba(255,94,26,0.32)' : '#ffede5';
      stroke = isDark ? '#ff5e1a' : '#ff4f00';
    }

    const midAngle = (i * 36 - 90) * (Math.PI / 180);
    const tx = cx + ((outerR + innerR) / 2) * Math.cos(midAngle);
    const ty = cy + ((outerR + innerR) / 2) * Math.sin(midAngle);

    paths += `
      <g class="cursor-pointer" data-wheel-slot="${i}">
        <path d="M ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 0 0 ${x4} ${y4} Z"
              fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
        <text x="${tx}" y="${ty + 3.5}" text-anchor="middle"
              fill="${isDark ? '#f4f4f6' : '#141413'}"
              font-family="JetBrains Mono, monospace" font-size="11" font-weight="700">
          ${i}
        </text>
      </g>
    `;
  }

  paths += `
    <circle cx="${cx}" cy="${cy}" r="${innerR - 5}" fill="${
    isDark ? '#121215' : '#ffffff'
  }" stroke="${isDark ? '#26262c' : '#e2e2dd'}" stroke-width="1.2" />
    <text x="${cx}" y="${cy - 4}" text-anchor="middle"
          fill="${isDark ? '#a1a1aa' : '#52524e'}"
          font-family="JetBrains Mono, monospace" font-size="9.5" font-weight="700">
      MODULO 10
    </text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle"
          fill="${isDark ? '#f4f4f6' : '#141413'}"
          font-family="JetBrains Mono, monospace" font-size="12" font-weight="800">
      ${replayBuffer.count}/10
    </text>
  `;

  svg.innerHTML = paths;
}

// 03. NORMAL FIFO QUEUE UI (Locked 62px Height .queue-pipe-viewport)
function renderBFSQueueCardUI() {
  const frontEl = document.getElementById('bfsFrontVal');
  const rearEl = document.getElementById('bfsRearVal');
  const sizeEl = document.getElementById('bfsSizeVal');
  const expEl = document.getElementById('bfsPlainExplanation');
  const listEl = document.getElementById('bfsQueueNodesList');

  if (!listEl) return;

  const bfs = appState.bfsCheckResult || graph.verifyReachabilityBFS();
  appState.bfsCheckResult = bfs;

  if (appState.bfsActiveSnapshot) {
    const snap = appState.bfsActiveSnapshot;
    const qNodes = snap.queueNodes;
    frontEl.textContent = snap.frontNode
      ? `(${snap.frontNode.row},${snap.frontNode.col})`
      : 'NULL';
    rearEl.textContent = snap.rearNode
      ? `(${snap.rearNode.row},${snap.rearNode.col})`
      : 'NULL';
    sizeEl.textContent = `${qNodes.length}`;
    expEl.textContent = `Dequeued FRONT (${snap.dequeuedNode.row},${snap.dequeuedNode.col}) · Enqueued ${snap.enqueuedNodes.length} neighbor(s) at REAR.`;

    if (qNodes.length === 0) {
      listEl.innerHTML = `<span class="font-mono-code text-xs sm:text-sm text-[var(--text-secondary)]">FRONT → NULL (Queue Empty)</span>`;
      return;
    }

    listEl.innerHTML =
      `<span class="font-mono-code text-xs font-bold text-[var(--accent-moss)] shrink-0">FRONT →</span>` +
      qNodes
        .slice(0, 10)
        .map(
          (n) => `
          <span class="px-2.5 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-line)] font-mono-code text-xs sm:text-sm font-semibold shrink-0">
            (${n.row},${n.col})
          </span>
          <span class="font-mono-code text-xs text-[var(--text-muted)] shrink-0">→</span>
        `
        )
        .join('') +
      `<span class="font-mono-code text-xs font-bold text-[var(--accent-ochre)] shrink-0">REAR</span>`;
    return;
  }

  if (bfs.reachable && bfs.shortestPath.length > 0) {
    const first = bfs.shortestPath[0];
    const last = bfs.shortestPath[bfs.shortestPath.length - 1];
    frontEl.textContent = `(${first.row},${first.col})`;
    rearEl.textContent = `(${last.row},${last.col})`;
    sizeEl.textContent = `${bfs.shortestPath.length} tiles`;
    expEl.textContent = `Shortest hop route (${bfs.shortestPath.length - 1} steps) verified via FIFO Queue.`;

    listEl.innerHTML =
      `<span class="font-mono-code text-xs font-bold text-[var(--accent-moss)] shrink-0">START →</span>` +
      bfs.shortestPath
        .map(
          (n, idx) => `
          <span class="px-2.5 py-1 rounded border font-mono-code text-xs sm:text-sm font-semibold shrink-0 ${
            idx === 0 || idx === bfs.shortestPath.length - 1
              ? 'bg-[var(--accent-moss-soft)] border-[var(--accent-moss)] text-[var(--accent-moss)]'
              : 'bg-[var(--bg-surface)] border-[var(--border-line)]'
          }">
            (${n.row},${n.col})
          </span>
          ${
            idx < bfs.shortestPath.length - 1
              ? '<span class="font-mono-code text-xs text-[var(--text-muted)] shrink-0">→</span>'
              : ''
          }
        `
        )
        .join('') +
      `<span class="font-mono-code text-xs font-bold text-[var(--accent-ochre)] shrink-0">→ GOAL</span>`;
  } else {
    frontEl.textContent = 'NULL';
    rearEl.textContent = 'NULL';
    sizeEl.textContent = '0';
    expEl.textContent = 'Goal unreachable! Walls or Traps block all paths.';
    listEl.innerHTML = `<span class="font-mono-code text-xs sm:text-sm text-[var(--accent-crimson)] font-semibold">FRONT → NULL · No valid path to Goal</span>`;
  }
}

// 04. SINGLY LINKED LIST INSPECTOR UI (Renders 4 Identical-Height .edge-fixed-row Cards -> Zero CLS)
function renderGraphInspectorUI() {
  const node = appState.selectedNode || graph.startNode || graph.getNode(0, 0);
  if (!node) return;

  document.getElementById('inspectCoord').textContent = `(${node.row}, ${node.col})`;
  document.getElementById('inspectTypeBadge').textContent = node.type;
  document.getElementById(
    'inspectMaxQ'
  ).innerHTML = `MAX: <strong>${node.getMaxQ().toFixed(2)}</strong>`;

  // Render visual pointer chain: edgesHead -> [DIR] -> NULL
  const chainEl = document.getElementById('inspectChainVisual');
  const edges = node.getEdgesArray();

  if (chainEl) {
    if (edges.length === 0) {
      chainEl.innerHTML = `<span class="text-[var(--text-secondary)]">edgesHead → <strong>NULL</strong> (Wall)</span>`;
    } else {
      chainEl.innerHTML =
        `<span class="font-bold text-[var(--accent-terracotta)]">HEAD</span><span>→</span>` +
        edges
          .map(
            (e) =>
              `<span class="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-line)] font-semibold">[${DIR_ARROWS[e.direction]}(${e.targetNode.row},${e.targetNode.col})]</span><span>→</span>`
          )
          .join('') +
        `<span class="font-bold text-[var(--text-muted)]">NULL</span>`;
    }
  }

  // Render all 4 directions with identical 38px row height (.edge-fixed-row) so layout never jumps!
  const listEl = document.getElementById('inspectEdgesList');
  if (!listEl) return;

  const bestEdge = node.getBestEdge();

  listEl.innerHTML = DIRS.map((dir) => {
    const edge = node.getEdge(dir);
    if (!edge) {
      return `
        <div class="edge-fixed-row px-3 rounded-lg border border-dashed border-[var(--border-line)] font-mono-code text-xs text-[var(--text-muted)] opacity-65">
          <span>${DIR_ARROWS[dir]} ${dir}</span>
          <span>NULL (Blocked)</span>
        </div>
      `;
    }

    const isBest = bestEdge === edge && Math.abs(edge.weight) > 0.05;
    const tagBadge =
      edge.transitionTag === 'PORTAL_WARP'
        ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-plum-soft)] text-[var(--accent-plum)]">PORTAL</span>'
        : edge.transitionTag === 'BOOST_SLIDE'
        ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-ochre-soft)] text-[var(--accent-ochre)]">BOOST</span>'
        : '';

    return `
      <button type="button" data-jump-row="${edge.targetNode.row}" data-jump-col="${edge.targetNode.col}"
              class="edge-fixed-row w-full text-left px-3 rounded-lg border font-mono-code text-xs transition-colors cursor-pointer ${
                isBest
                  ? 'border-[var(--accent-moss)] bg-[var(--accent-moss-soft)]'
                  : 'border-[var(--border-line)] bg-[var(--bg-well)] hover:border-[var(--border-strong)]'
              }">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="font-bold">${DIR_ARROWS[dir]} ${dir}</span>
          <span class="text-[var(--text-secondary)] truncate">→ (${edge.targetNode.row},${edge.targetNode.col})</span>
          ${tagBadge}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[11px] text-[var(--text-secondary)]">n=${edge.visits}</span>
          <span class="font-bold ${
            edge.weight > 0
              ? 'text-[var(--accent-moss)]'
              : edge.weight < 0
              ? 'text-[var(--accent-crimson)]'
              : 'text-[var(--text-primary)]'
          }">${edge.weight >= 0 ? `+${edge.weight.toFixed(1)}` : edge.weight.toFixed(1)}</span>
        </div>
      </button>
    `;
  }).join('');

  listEl.querySelectorAll('[data-jump-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = Number(btn.getAttribute('data-jump-row'));
      const c = Number(btn.getAttribute('data-jump-col'));
      const target = graph.getNode(r, c);
      if (target) {
        appState.selectedNode = target;
        renderGraphInspectorUI();
        drawArena();
      }
    });
  });
}

// ============================================================================
// 13. LEARNING CURVE CHART (DEDICATED Y-AXIS GUTTER + 60-POINT BUCKETING)
// ============================================================================

function downsampleSeries(arr, maxPoints = 60) {
  if (arr.length <= maxPoints) return arr.slice();
  const result = [];
  const bucketSize = arr.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let sum = 0;
    for (let j = start; j < end && j < arr.length; j++) {
      sum += arr[j];
    }
    result.push(sum / (end - start));
  }
  return result;
}

function renderLearningCurve() {
  const canvas = document.getElementById('lcCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(220, Math.floor(rect.width));
  const h = 102;
  const dpr = window.devicePixelRatio || 1;

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }

  const c = canvas.getContext('2d');
  c.save();
  c.scale(dpr, dpr);
  c.clearRect(0, 0, w, h);

  // Dedicated 44px left Y-axis gutter so labels NEVER overlap the plotted lines
  const padLeft = 44;
  const padRight = 10;
  const padTop = 8;
  const padBottom = 12;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  // Horizontal guide lines + Left Y-axis percentage labels
  c.strokeStyle = 'rgba(255,255,255,0.09)';
  c.lineWidth = 1;
  c.fillStyle = '#a1a1aa';
  c.font = '600 10.5px "JetBrains Mono", monospace';
  c.textAlign = 'right';
  c.textBaseline = 'middle';

  const yLevels = [
    { frac: 0, label: '100%' },
    { frac: 0.5, label: '50%' },
    { frac: 1, label: '0%' },
  ];

  for (const lvl of yLevels) {
    const y = Math.round(padTop + lvl.frac * plotH) + 0.5;
    c.beginPath();
    c.moveTo(padLeft, y);
    c.lineTo(w - padRight, y);
    c.stroke();
    c.fillText(lvl.label, padLeft - 8, y);
  }

  const rawRates = appState.historyWinRates;
  const rawRewards = appState.historyRewards;

  if (rawRates.length < 2) {
    c.fillStyle = '#a1a1aa';
    c.textAlign = 'center';
    c.font = '500 11px "JetBrains Mono", monospace';
    c.fillText(
      'Run episodes to plot Win % & Score curve',
      padLeft + plotW / 2,
      padTop + plotH / 2
    );
    c.restore();
    return;
  }

  // Downsample into at most 60 clean points so 18,000+ runs never turn into noisy vertical spikes
  const rates = downsampleSeries(rawRates, 60);
  const rewards = downsampleSeries(rawRewards, 60);

  // 1. Normalized Reward Curve (Dashed Industrial Amber)
  c.save();
  c.strokeStyle = '#f59e0b';
  c.lineWidth = 1.8;
  c.setLineDash([4, 3]);
  c.beginPath();
  for (let i = 0; i < rewards.length; i++) {
    const x = padLeft + (i / (rewards.length - 1)) * plotW;
    const norm = Math.max(0, Math.min(1, (rewards[i] + 60) / 160));
    const y = padTop + (1 - norm) * plotH;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  c.restore();

  // 2. Rolling Win Rate Curve (Solid Precision Emerald + Soft Area Fill)
  c.save();
  c.beginPath();
  for (let i = 0; i < rates.length; i++) {
    const x = padLeft + (i / (rates.length - 1)) * plotW;
    const norm = Math.max(0, Math.min(1, rates[i] / 100));
    const y = padTop + (1 - norm) * plotH;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.strokeStyle = '#10b981';
  c.lineWidth = 2.4;
  c.stroke();

  c.lineTo(padLeft + plotW, padTop + plotH);
  c.lineTo(padLeft, padTop + plotH);
  c.closePath();
  c.fillStyle = 'rgba(16, 185, 129, 0.16)';
  c.fill();
  c.restore();

  c.restore();
}

// ============================================================================
// 14. INTERACTIVE CONTROLS, MODALS & EVENT LISTENERS
// ============================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  const borderCol =
    type === 'warn'
      ? 'border-[var(--accent-crimson)]'
      : 'border-[var(--accent-terracotta)]';

  toast.className = `arch-card px-4 py-3 border-l-4 ${borderCol} shadow-lg font-mono-code text-xs sm:text-sm pointer-events-auto`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2800);
}

// Permanently visible step bar (Zero CLS: never toggles display:none)
function updateDebuggerUI() {
  const bar = document.getElementById('debuggerBar');
  const label = document.getElementById('debuggerStateLabel');
  const pauseBtn = document.getElementById('btnPauseResumeDebug');
  const stepBtn = document.getElementById('btnStepOnceDebug');
  const stopBtn = document.getElementById('btnStopDebug');
  if (!bar || !label || !pauseBtn || !stepBtn || !stopBtn) return;

  if (appState.isRunningEpisode) {
    bar.className =
      'sm:col-span-5 h-10 px-2.5 rounded-lg border border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-soft)] flex items-center justify-between gap-1.5 transition-colors';
    pauseBtn.disabled = false;
    stepBtn.disabled = !appState.debugPaused;
    stopBtn.disabled = false;

    if (appState.debugPaused) {
      pauseBtn.textContent = 'Resume';
    } else {
      pauseBtn.textContent = 'Pause';
    }
  } else {
    bar.className =
      'sm:col-span-5 h-10 px-2.5 rounded-lg border border-[var(--border-line)] bg-[var(--bg-well)] flex items-center justify-between gap-1.5 transition-colors';
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = true;
    stepBtn.disabled = true;
    stopBtn.disabled = true;
  }
}

function setBoardMode(mode) {
  appState.boardMode = mode;
  document.querySelectorAll('.board-mode-btn').forEach((btn) => {
    const m = btn.getAttribute('data-boardmode');
    btn.classList.toggle('active', m === mode);
  });

  const editPanel = document.getElementById('editPalettePanel');
  const playPanel = document.getElementById('manualPlayPanel');
  const sub = document.getElementById('modeSubtitle');

  editPanel.classList.toggle('hidden', mode !== 'EDIT');
  editPanel.classList.toggle('flex', mode === 'EDIT');

  playPanel.classList.toggle('hidden', mode !== 'PLAY');
  playPanel.classList.toggle('flex', mode === 'PLAY');

  if (mode === 'INSPECT') {
    sub.textContent = '· Click tile to inspect';
  } else if (mode === 'EDIT') {
    sub.textContent = `· Paint ${appState.activeBrush}`;
  } else if (mode === 'PLAY') {
    sub.textContent = '· Use Arrow Keys / WASD';
    resetHumanPlayRun();
  }
  drawArena();
}

function applyBrushToTile(node) {
  if (!node) return;
  const brush = appState.activeBrush;

  if (brush === 'START') {
    const oldStart = graph.findFirstNodeOfType('START');
    if (oldStart) oldStart.setType('EMPTY');
    node.setType('START');
    graph.startNode = node;
  } else if (brush === 'GOAL') {
    const oldGoal = graph.findFirstNodeOfType('GOAL');
    if (oldGoal) oldGoal.setType('EMPTY');
    node.setType('GOAL');
    graph.goalNode = node;
  } else if (brush === 'PORTAL_A') {
    const oldA = graph.findFirstNodeOfType('PORTAL_A');
    if (oldA) oldA.setType('EMPTY');
    node.setType('PORTAL_A');
  } else if (brush === 'PORTAL_B') {
    const oldB = graph.findFirstNodeOfType('PORTAL_B');
    if (oldB) oldB.setType('EMPTY');
    node.setType('PORTAL_B');
  } else if (brush === 'BOOST') {
    if (node.type === 'START' || node.type === 'GOAL') return;
    const dir = DIRS[appState.boostBrushDirIndex];
    node.setType('BOOST', dir);
  } else {
    if (node.type === 'START' || node.type === 'GOAL') return;
    node.setType(brush);
  }

  graph.rebuildEdges(true);
  appState.bfsCheckResult = graph.verifyReachabilityBFS();
  appState.selectedNode = node;
  renderAllPanels();
}

function resetHumanPlayRun() {
  appState.humanNode = graph.startNode;
  appState.humanSteps = 0;
  appState.humanScore = 0;
  updateHumanPlayHUD();
  drawArena();
}

function updateHumanPlayHUD() {
  const sEl = document.getElementById('humanStepsVal');
  const pEl = document.getElementById('humanScoreVal');
  if (sEl) sEl.textContent = `${appState.humanSteps}`;
  if (pEl) pEl.textContent = `${appState.humanScore}`;
}

function stepHumanMove(direction) {
  if (appState.boardMode !== 'PLAY') return;
  if (!appState.humanNode) appState.humanNode = graph.startNode;

  const curr = appState.humanNode;
  if (curr.type === 'GOAL' || curr.type === 'TRAP') {
    resetHumanPlayRun();
    return;
  }

  const edge = curr.getEdge(direction);
  if (!edge) {
    showToast(`Blocked! No ${direction} move in Singly Linked List.`, 'warn');
    return;
  }

  const next = edge.targetNode;
  appState.humanSteps++;
  appState.humanScore = Math.round((appState.humanScore + next.reward) * 10) / 10;
  appState.humanNode = next;
  appState.selectedNode = next;

  trajectoryStack.push(curr, edge, next.reward, appState.humanSteps);
  replayBuffer.enqueue(curr, edge, next.reward, next);

  updateHumanPlayHUD();
  renderAllPanels();

  if (next.type === 'GOAL') {
    showToast(`You reached Goal (+100)! Total Score: ${appState.humanScore}`);
  } else if (next.type === 'TRAP') {
    showToast(`Stepped into Trap (-50)! Click Restart to try again.`, 'warn');
  }
}

function bindEvents() {
  // Collapsible AI Tuning & Map Settings Drawer
  const tuningDrawer = document.getElementById('tuningDrawer');
  const toggleBtnInline = document.getElementById('btnToggleTuningDrawer');
  const toggleBtnHeader = document.getElementById('btnHeaderSettings');

  function toggleTuningDrawer() {
    if (!tuningDrawer) return;
    const isHidden = tuningDrawer.classList.contains('hidden');
    tuningDrawer.classList.toggle('hidden', !isHidden);
    tuningDrawer.classList.toggle('flex', isHidden);
    if (toggleBtnInline) {
      toggleBtnInline.textContent = isHidden ? '⚙ Hide Tuning ▴' : '⚙ Tune AI ▾';
    }
    if (toggleBtnHeader) {
      toggleBtnHeader.classList.toggle('btn-terracotta', isHidden);
    }
  }

  if (toggleBtnInline) {
    toggleBtnInline.addEventListener('click', toggleTuningDrawer);
  }
  if (toggleBtnHeader) {
    toggleBtnHeader.addEventListener('click', toggleTuningDrawer);
  }

  // Data Structure View Switcher (All 4 2x2 Grid vs Focused Single Structure)
  const dsaGrid = document.getElementById('dsaCardsGrid');
  document.querySelectorAll('.dsa-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-dsaview') || 'all';
      document.querySelectorAll('.dsa-view-btn').forEach((el) => {
        el.classList.toggle('btn-terracotta', el === btn);
      });

      if (dsaGrid) {
        dsaGrid.className =
          view === 'all'
            ? 'grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch'
            : 'grid grid-cols-1 gap-5 items-stretch';
      }

      document.querySelectorAll('[data-dsacard]').forEach((card) => {
        const cardId = card.getAttribute('data-dsacard');
        const show = view === 'all' || cardId === view;
        card.classList.toggle('hidden', !show);
        card.classList.toggle('flex', show);
      });
    });
  });

  // 2-Theme Toggle (Studio Light <-> Carbon Dark)
  document.getElementById('btnThemeToggle').addEventListener('click', () => {
    appState.theme = appState.theme === 'light' ? 'dark' : 'light';
    const isDark = appState.theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);

    const iconEl = document.getElementById('themeToggleIcon');
    const labelEl = document.getElementById('themeToggleLabel');
    if (iconEl && labelEl) {
      iconEl.textContent = isDark ? '☾' : '☀';
      labelEl.textContent = isDark ? 'Carbon Dark' : 'Studio Light';
    }
    renderAllPanels();
    showToast(
      isDark
        ? 'Switched to Carbon Dark (Obsidian & Signal Orange)'
        : 'Switched to Studio Light (Industrial Alabaster & Signal Orange)'
    );
  });

  // Study Guide Modal
  const helpModal = document.getElementById('helpModal');
  document.getElementById('btnOpenStudyGuide').addEventListener('click', () => {
    helpModal.classList.remove('hidden');
    helpModal.classList.add('flex');
  });
  document.getElementById('btnCloseHelpModal').addEventListener('click', () => {
    helpModal.classList.add('hidden');
    helpModal.classList.remove('flex');
  });

  // Pointer Code Modal
  const codeModal = document.getElementById('codeModal');
  const codePre = document.getElementById('dsaCodeDisplay');
  let activeCodeTab = 'ring';

  function renderCodeModalTab(tabKey) {
    activeCodeTab = tabKey;
    codePre.textContent = DSA_CODE_SNIPPETS[tabKey] || '';
    document.querySelectorAll('.code-tab-btn').forEach((btn) => {
      const k = btn.getAttribute('data-codetab');
      if (k === tabKey) {
        btn.className =
          'code-tab-btn px-3.5 py-2 rounded-t-lg text-xs sm:text-sm font-mono-code font-bold bg-[var(--bg-surface)] text-[var(--accent-terracotta)] border border-b-0 border-[var(--border-line)] cursor-pointer';
      } else {
        btn.className =
          'code-tab-btn px-3.5 py-2 rounded-t-lg text-xs sm:text-sm font-mono-code font-medium text-[var(--text-secondary)] cursor-pointer';
      }
    });
  }

  document.getElementById('btnViewCode').addEventListener('click', () => {
    renderCodeModalTab(activeCodeTab);
    codeModal.classList.remove('hidden');
    codeModal.classList.add('flex');
  });

  document.getElementById('btnCloseCodeModal').addEventListener('click', () => {
    codeModal.classList.add('hidden');
    codeModal.classList.remove('flex');
  });

  document.querySelectorAll('.code-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderCodeModalTab(btn.getAttribute('data-codetab'));
    });
  });

  document.getElementById('btnCopyCode').addEventListener('click', () => {
    navigator.clipboard.writeText(DSA_CODE_SNIPPETS[activeCodeTab] || '');
    showToast('Pointer source code copied to clipboard.');
  });

  // Board Mode Tabs
  document.querySelectorAll('.board-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setBoardMode(btn.getAttribute('data-boardmode'));
    });
  });

  // Brush Selection
  document.querySelectorAll('.brush-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = btn.getAttribute('data-brush');
      if (b === 'BOOST' && appState.activeBrush === 'BOOST') {
        appState.boostBrushDirIndex = (appState.boostBrushDirIndex + 1) % 4;
        const dir = DIRS[appState.boostBrushDirIndex];
        document.getElementById('boostBrushGlyph').textContent = DIR_ARROWS[dir];
        document.getElementById('boostBrushLabel').textContent = `Boost ${DIR_ARROWS[dir]}`;
      }
      appState.activeBrush = b;
      document.querySelectorAll('.brush-btn').forEach((el) => {
        el.classList.toggle('btn-terracotta', el.getAttribute('data-brush') === b);
      });
    });
  });

  // Canvas Click & Drag Painting
  let isPointerDown = false;
  function getNodeFromPointerEvent(e) {
    const rect = gridCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const gutter = 24;
    if (x < gutter || y < gutter) return null;
    const cell = (rect.width - gutter) / 10;
    const col = Math.floor((x - gutter) / cell);
    const row = Math.floor((y - gutter) / cell);
    return graph.getNode(row, col);
  }

  gridCanvas.addEventListener('pointerdown', (e) => {
    isPointerDown = true;
    const node = getNodeFromPointerEvent(e);
    if (!node) return;
    if (appState.boardMode === 'EDIT') {
      applyBrushToTile(node);
    } else {
      appState.selectedNode = node;
      renderGraphInspectorUI();
      drawArena();
    }
  });

  gridCanvas.addEventListener('pointermove', (e) => {
    if (!isPointerDown || appState.boardMode !== 'EDIT') return;
    const node = getNodeFromPointerEvent(e);
    if (node && node !== appState.selectedNode) {
      applyBrushToTile(node);
    }
  });

  window.addEventListener('pointerup', () => {
    isPointerDown = false;
  });

  // Map Presets
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      document.querySelectorAll('.preset-btn').forEach((b) => {
        b.classList.toggle('btn-terracotta', b === btn);
      });
      graph.loadPreset(preset);
      resetBrainAndTelemetry(false);
      for (let i = 0; i < 25; i++) runSilentEpisode();
      renderAllPanels();
      showToast(`Loaded "${preset}" maze preset.`);
    });
  });

  document.getElementById('btnRandomizeMap').addEventListener('click', () => {
    graph.randomizeSafeMaze();
    resetBrainAndTelemetry(false);
    for (let i = 0; i < 25; i++) runSilentEpisode();
    renderAllPanels();
    showToast('Generated random Queue-verified solvable maze.');
  });

  // Save / Load JSON
  document.getElementById('btnExportMap').addEventListener('click', () => {
    const blob = new Blob([graph.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gridworld-maze.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  const fileInput = document.getElementById('mapFileInput');
  document.getElementById('btnImportMap').addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        graph.importJSON(String(reader.result));
        resetBrainAndTelemetry(false);
        showToast('Custom maze JSON loaded.');
      } catch (err) {
        showToast('Invalid JSON file.', 'warn');
      }
    };
    reader.readAsText(file);
  });

  // Simulation Action Buttons
  document.getElementById('btnWatchEpisode').addEventListener('click', () => {
    startAnimatedEpisode({ isOptimalRun: false, startPaused: false });
  });

  document.getElementById('btnTrain100').addEventListener('click', () => {
    if (appState.isRunningEpisode) return;
    for (let i = 0; i < 100; i++) {
      runSilentEpisode();
    }
    setPhaseBanner(
      `COMPLETED 100 FAST RUNS · TOTAL RUNS: ${appState.episodeCount}`,
      '100× DONE'
    );
    renderAllPanels();
  });

  document.getElementById('btnAutoTrain').addEventListener('click', () => {
    appState.isAutoTraining = !appState.isAutoTraining;
    const lbl = document.getElementById('autoTrainLabel');
    const btn = document.getElementById('btnAutoTrain');
    if (appState.isAutoTraining) {
      lbl.textContent = '∞ Auto: ON';
      btn.classList.add('btn-terracotta');
      if (!appState.isRunningEpisode) {
        startAnimatedEpisode({ isOptimalRun: false, startPaused: false });
      }
    } else {
      lbl.textContent = '∞ Auto: OFF';
      btn.classList.remove('btn-terracotta');
    }
  });

  document.getElementById('btnStepDebugStart').addEventListener('click', () => {
    if (appState.isRunningEpisode) {
      appState.stepDebugMode = true;
      appState.debugPaused = true;
      updateDebuggerUI();
      return;
    }
    startAnimatedEpisode({ isOptimalRun: false, startPaused: true });
  });

  document.getElementById('btnPauseResumeDebug').addEventListener('click', () => {
    if (!appState.isRunningEpisode) return;
    appState.debugPaused = !appState.debugPaused;
    if (!appState.debugPaused && appState.debugStepResolver) {
      const r = appState.debugStepResolver;
      appState.debugStepResolver = null;
      r();
    }
    updateDebuggerUI();
  });

  document.getElementById('btnStepOnceDebug').addEventListener('click', () => {
    if (!appState.isRunningEpisode) return;
    appState.stepDebugMode = true;
    appState.debugPaused = true;
    if (appState.debugStepResolver) {
      const r = appState.debugStepResolver;
      appState.debugStepResolver = null;
      r();
    }
    updateDebuggerUI();
  });

  document.getElementById('btnStopDebug').addEventListener('click', () => {
    appState.stopRequested = true;
    appState.isAutoTraining = false;
    document.getElementById('autoTrainLabel').textContent = '∞ Auto: OFF';
    document.getElementById('btnAutoTrain').classList.remove('btn-terracotta');
    if (appState.debugStepResolver) {
      const r = appState.debugStepResolver;
      appState.debugStepResolver = null;
      r();
    }
  });

  document.getElementById('btnAnimateBFS').addEventListener('click', () => {
    animateBFSWavefront();
  });
  document.getElementById('btnInlineAnimateBFS').addEventListener('click', () => {
    animateBFSWavefront();
  });

  document.getElementById('btnOptimalRun').addEventListener('click', () => {
    startAnimatedEpisode({ isOptimalRun: true, startPaused: false });
  });

  // Sliders & Checkboxes
  document.getElementById('speedSlider').addEventListener('input', (e) => {
    appState.speedPercent = Number(e.target.value);
    document.getElementById('speedValue').textContent = `${appState.speedPercent}%`;
  });

  document.getElementById('sliderAlpha').addEventListener('input', (e) => {
    appState.alpha = Number(e.target.value);
    document.getElementById('valAlpha').textContent = appState.alpha.toFixed(2);
  });

  document.getElementById('sliderGamma').addEventListener('input', (e) => {
    appState.gamma = Number(e.target.value);
    document.getElementById('valGamma').textContent = appState.gamma.toFixed(2);
  });

  document.getElementById('sliderDecay').addEventListener('input', (e) => {
    appState.epsilonDecay = Number(e.target.value);
    document.getElementById('valDecay').textContent = appState.epsilonDecay.toFixed(3);
  });

  document.getElementById('toggleHeatmap').addEventListener('change', (e) => {
    appState.showHeatmap = e.target.checked;
    drawArena();
  });

  document.getElementById('toggleArrows').addEventListener('change', (e) => {
    appState.showArrows = e.target.checked;
    drawArena();
  });

  document.getElementById('toggleShortestPath').addEventListener('change', (e) => {
    appState.showShortestPath = e.target.checked;
    drawArena();
  });

  document.getElementById('toggleReplay').addEventListener('change', (e) => {
    appState.useReplayBuffer = e.target.checked;
  });

  document.getElementById('btnResetBrain').addEventListener('click', () => {
    resetBrainAndTelemetry(true);
  });

  // Human Play D-Pad & Keyboard
  document.querySelectorAll('.dpad-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      stepHumanMove(btn.getAttribute('data-dpad'));
    });
  });

  document.getElementById('btnResetManualRun').addEventListener('click', () => {
    resetHumanPlayRun();
  });

  window.addEventListener('keydown', (e) => {
    if (appState.boardMode !== 'PLAY') return;
    const keyMap = {
      ArrowUp: 'UP',
      KeyW: 'UP',
      ArrowRight: 'RIGHT',
      KeyD: 'RIGHT',
      ArrowDown: 'DOWN',
      KeyS: 'DOWN',
      ArrowLeft: 'LEFT',
      KeyA: 'LEFT',
    };
    if (keyMap[e.code]) {
      e.preventDefault();
      stepHumanMove(keyMap[e.code]);
    }
  });

  window.addEventListener('resize', () => {
    renderLearningCurve();
    drawArena();
  });
}

function resetBrainAndTelemetry(toast = true) {
  appState.stopRequested = true;
  graph.resetAllWeights();
  trajectoryStack.clear();
  replayBuffer.clear();

  appState.epsilon = 1.0;
  appState.episodeCount = 0;
  appState.winCount = 0;
  appState.lastReward = 0;
  appState.lastOutcomeText = 'Ready';
  appState.historyWinRates = [];
  appState.historyRewards = [];
  appState.recentOutcomesWindow = [];
  appState.activeTrail = [];
  appState.agentNode = graph.startNode;
  appState.selectedNode = graph.startNode;
  appState.aiBestScoreBenchmark = null;
  appState.bfsCheckResult = graph.verifyReachabilityBFS();

  setPhaseBanner('MEMORY RESET · ALL SCORES CLEARED TO 0.0', 'RESET');
  setStackStatusBanner('TOP → NULL', 'READY');
  renderAllPanels();
  if (toast) showToast('All learned tile scores, Stack, and Circular Queue cleared.');
}

// ============================================================================
// 15. INITIALIZATION (PRE-SEEDED WITH 25 RUNS SO ALL PANELS START FULFILLED)
// ============================================================================

function initApp() {
  graph.loadPreset('default');
  appState.selectedNode = graph.startNode;
  appState.agentNode = graph.startNode;
  appState.bfsCheckResult = graph.verifyReachabilityBFS();

  // Run 25 silent episodes on startup so the Win Curve, Circular Queue [0..9],
  // and Linked List scores are immediately populated and ready to explore
  for (let i = 0; i < 25; i++) {
    runSilentEpisode();
  }

  bindEvents();
  updateDebuggerUI();
  renderAllPanels();
}

initApp();
