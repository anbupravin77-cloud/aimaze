# GRIDWORLD GYM — Interactive Data Structures & AI Maze Lab
**Complete Project Documentation & Technical Report**

---

## 1. Abstract / Executive Summary
**Gridworld Gym** is an interactive educational visualization platform that demonstrates how four core **Data Structures**—**Circular Queue (Ring Buffer)**, **Normal FIFO Queue**, **Linked Stack (LIFO)**, and **Singly Linked List**—work together inside an autonomous pathfinding and Reinforcement Learning (Q-Learning) engine.

Instead of teaching data structures as isolated console programs that print numbers, Gridworld Gym embeds them inside a live **10×10 Maze Arena**. Every step the rover takes, every path check it performs, and every score update it calculates is driven by explicit pointer-based JavaScript classes (`CircularBuffer`, `LinkedQueue`, `TrajectoryStack`, `GridNode` / `GraphEdge`) with zero external runtime dependencies.

---

## 2. Problem Statement & Objectives

### Problem Statement
In traditional computer science classrooms, students learn **Stacks**, **Queues**, **Circular Queues**, and **Singly Linked Lists** as abstract operations (`push`, `pop`, `enqueue`, `dequeue`). Students rarely see how these four structures cooperate inside a real-world system or why pointer representations outperform fixed 2D matrices in sparse environments.

### Project Objectives
1. **Unify Core Syllabus Data Structures**: Combine Circular Queue (`01`), Normal FIFO Queue (`02`), Linked Stack (`03`), and Singly Linked List (`04`) into a single cohesive application.
2. **Real-Time Pointer Transparency**: Show live `.next` pointer chains, `TOP` stack frames, `FRONT`/`REAR` queue markers, and `(rear + 1) % 10` modulo wrap-around operations as the rover moves.
3. **Interactive Verification & Debugging**: Allow students and teachers to step through pointer operations one move at a time (`Step Debug`), paint custom maze obstacles (`Paint Tiles`), or play manually (`Human Play`) to compare human intuition against algorithmic search.
4. **Zero-Dependency Architecture**: Implement the entire simulation using three standalone files (`index.html`, `style.css`, `script.js`) using HTML5 `<canvas>`, SVG, and vanilla ES6 classes.

---

## 3. System Architecture (3-File Standalone Design)

| File | Role & Responsibilities |
| :--- | :--- |
| **`index.html`** | Defines the **Spatial Bento Command Deck** layout: Floating Capsule Header, Left 5-Column Hardware Maze & Controls Deck, Right 7-Column Telemetry & 2×2 Data Structure Bento Grid, plus the **Study Guide** and **Pointer Source Code** modals. |
| **`style.css`** | Implements the **Tactile Hardware & Spatial Bento Design System** with two themes (**Studio Light** & **Carbon Dark**), spring-physics keycap buttons, dot-matrix studio chassis background, and locked-height containers (`CLS = 0`) so numbers update without layout shift. |
| **`script.js`** | Contains the four custom Data Structure classes, the 10×10 Maze environment builder, the Level-by-Level FIFO Queue search (BFS), the Epsilon-Greedy + Bellman Q-Learning engine, the HTML5 Canvas renderer, and all interactive event handlers. |

---

## 4. Detailed Data Structure Implementations (`01` → `04`)

### `01` · Circular Queue (10-Slot Ring Buffer)
- **Class Name**: `CircularBuffer` (`capacity = 10`)
- **Purpose**: Stores the rover's **10 most recent moves** (`stateId`, `direction`, `reward`, `nextStateId`, `stepStamp`) for Experience Replay.
- **How It Works**:
  - Uses a fixed 10-element array (`this.buffer = new Array(10).fill(null)`).
  - Maintains two integer indices: `head` (`FRONT`, oldest slot) and `tail` (`REAR`, next write slot).
  - When a new move is recorded via `enqueue()`, it writes to `this.buffer[this.tail]` and advances `tail` using **modulo arithmetic**:
    ```javascript
    this.tail = (this.tail + 1) % this.capacity; // Wraps index 9 -> 0
    ```
  - When the buffer is full (`count === 10`), `head` also advances via `(this.head + 1) % 10`, overwriting the oldest transition in $O(1)$ time without shifting array elements.
- **Complexity**:
  - **Insert (`enqueue`)**: $O(1)$ Time, $O(1)$ Fixed Space (10 slots).
  - **Random Replay (`sampleBatch`)**: $O(k)$ where $k = 4$ sampled slots.

---

### `02` · Normal FIFO Queue (First-In, First-Out Linked Queue)
- **Class Names**: `BFSQueueNode` & `LinkedQueue`
- **Purpose**: Performs **Level-by-Level Shortest Path Search (Breadth-First Search / BFS)** from `Start (0,0)` to `Goal (9,9)`.
- **How It Works**:
  - Built with pointer nodes (`this.node`, `this.next`) and two queue pointers: `this.front` and `this.rear`.
  - **`enqueue(gridNode)`**: Creates a new `BFSQueueNode` and attaches it to `this.rear.next`, then updates `this.rear`.
  - **`dequeue()`**: Removes `this.front`, advances `this.front = this.front.next`, and returns the tile in strict **First-In, First-Out** order.
  - Before any episode runs—or when the user clicks **`Queue Path`**—the FIFO Queue expands outward wave by wave, verifying whether a valid path to the Goal exists and computing the exact minimum hop count.
- **Complexity**:
  - **`enqueue` / `dequeue`**: $O(1)$ Time per operation.
  - **Full Maze Verification (`verifyReachabilityBFS`)**: $O(V + E)$ where $V \le 100$ tiles and $E \le 400$ move edges.

---

### `03` · Linked Stack (LIFO — Last-In, First-Out)
- **Class Names**: `StackNode` & `TrajectoryStack`
- **Purpose**: Records the rover's forward path during an episode (`STACK PUSH`) and unwinds the path in reverse order (`STACK POP`) to propagate rewards backward from the Goal or Trap to the Start tile.
- **How It Works**:
  - Each `StackNode` stores `(node, edge, reward, stepIndex, oldQ, newQ, next)`.
  - **Phase 1 — Forward Walk (`push`)**: Every time the rover steps onto a tile, a new `StackNode` is pushed onto `this.top`:
    ```javascript
    frame.next = this.top;
    this.top = frame;
    this.size++;
    ```
  - **Phase 2 — Backward Score Update (`pop`)**: When the episode terminates at `Goal (+100)`, `Trap (-50)`, or `Max Steps`, the rover must credit earlier moves that led to that outcome. Because the **last move taken must be updated first**, the engine pops frames from `this.top` one by one (`this.top = this.top.next`), visually moving the rover backward along its trail while updating each move's learned score.
- **Complexity**:
  - **`push` / `pop`**: $O(1)$ Time per step.
  - **Space**: $O(L)$ where $L \le 38$ is the episode path length.

---

### `04` · Singly Linked List (Per-Tile Valid Move Chains)
- **Class Names**: `GraphEdge` & `GridNode`
- **Purpose**: Represents the valid outgoing neighbor moves (`UP`, `RIGHT`, `DOWN`, `LEFT`) for each of the 100 maze tiles without wasting memory on a $100 \times 100$ Adjacency Matrix.
- **How It Works**:
  - Each `GridNode` `(row, col)` holds a head pointer `this.edgesHead = null`.
  - During `rebuildEdges()`, the maze checks the 4 cardinal neighbors of `(row, col)`. If a neighbor is inside the board and is **not a Wall**, it appends a `GraphEdge` node to the tile's Singly Linked List (`edgesHead -> edge1 -> edge2 -> NULL`).
  - Each `GraphEdge` stores:
    - `direction`: `'UP' | 'RIGHT' | 'DOWN' | 'LEFT'`
    - `targetNode`: Pointer to destination `GridNode` (accounting for Portal warps and Boost slides)
    - `entryNode`: Pointer to immediate adjacent `GridNode` (used for orthogonal trail rendering)
    - `weight`: Learned move score $Q(s, a)$
    - `visits`: Number of times this move was tried (`n`)
    - `next`: Pointer to the next valid move on the same tile
- **Memory Advantage**:
  - A 2D Adjacency Matrix for 100 tiles requires $100 \times 100 = 10,000$ cells.
  - Our Singly Linked List stores at most 4 nodes per non-wall tile ($\approx 300$ nodes total), saving over **96% of memory**.

---

## 5. AI Decision-Making & Score Update Logic (Plain-English Summary)

### 5.1 Tile Types & Point Values
| Tile Type | Symbol | Points (`reward`) | Special Behavior |
| :--- | :---: | :---: | :--- |
| **Start** | `S` | `-1` | Starting tile at `(0,0)` |
| **Goal** | `G` | `+100` | Ends episode with a win |
| **Trap** | `✕` | `-50` | Ends episode immediately with a penalty |
| **Bonus** | `◇` | `+25` | Awards `+25` points once per episode |
| **Boost Pad** | `»` | `-0.5` | Slides the rover 1 extra tile in arrow direction |
| **Portals** | `A` / `B` | `-0.5` | Teleports rover instantly between twin portals |
| **Empty Tile** | ` ` | `-1` | Small `-1` step cost encourages finding the shortest route |
| **Wall** | `///` | `0` | Impassable; excluded from Singly Linked Lists |

### 5.2 Exploration vs. Exploitation (`chooseActionEpsilonGreedy`)
At every tile, the rover inspects its **Singly Linked List (`04`)** of valid moves:
1. **Immediate Goal Check**: If any linked list edge leads directly to `Goal`, the rover takes it immediately.
2. **Trap & U-Turn Filtering**: Moves known to lead into a `Trap` (`weight <= -15`) and unnecessary $180^\circ$ U-turns are filtered out.
3. **Random Explore Mode** (with probability `Random Explore %`): Combines an unvisited-edge novelty bonus with FIFO Queue distance to discover new corridors quickly.
4. **Best Known Score Mode** (with probability `1 - Random Explore %` or during `Best Path`): Picks the Linked List node with the highest learned score (`weight`).

### 5.3 Bellman Score Update Formula (`updateEdgeQValue`)
When the **Linked Stack (`03`)** pops a move $(s, a, r, s')$, its score is updated using the Q-Learning rule:
$$\text{NewScore} = \text{OldScore} + \alpha \cdot \left[ R + \gamma \cdot \max Q(s') - \text{OldScore} \right]$$
- **$\alpha$ (`Learn Speed`, default `0.45`)**: How strongly a single run updates the stored score.
- **$\gamma$ (`Future Plan`, default `0.92`)**: How much future rewards (`+100` Goal) carry back to earlier tiles.

---

## 6. User Interface & Controls Reference

### Left Column: 10×10 Hardware Maze & Simulation Controls
- **Mode Switcher (`Inspect` | `Edit` | `Play`)**:
  - **Inspect**: Click any tile `(row, col)` to inspect its Singly Linked List pointers in Card `04`.
  - **Edit (Paint Tiles)**: Paint `Wall`, `Trap -50`, `Bonus +25`, `Boost`, `Portal A/B`, `Start`, `Goal`, or `Erase`, and load presets (`Classic`, `Portals`, `Conveyor`, `Random`) or `Save`/`Load` JSON.
  - **Play (Human Play)**: Drive the rover manually using **Arrow Keys / WASD** or the on-screen D-Pad and compare your score against the **AI Best** benchmark.
- **6 Hardware Action Buttons**:
  1. **`▶ Watch 1 Run`**: Animates Phase 1 (`STACK PUSH` forward walk) and Phase 2 (`STACK POP` backward trace).
  2. **`⚡ Fast 100×`**: Runs 100 episodes instantaneously to train all Linked List scores.
  3. **`∞ Auto: OFF / ON`**: Continuously runs animated episodes back-to-back.
  4. **`⏯ Step Debug`**: Pauses execution so you can click **`Step →`** to advance one pointer operation at a time.
  5. **`◎ Queue Path`**: Animates the **Normal FIFO Queue (`02`)** level-by-level wavefront across the maze.
  6. **`★ Best Path`**: Runs a pure greedy episode (`0%` randomness) following the highest Singly Linked List scores.

### Right Column: Telemetry & 2×2 Data Structure Bento Grid
- **Top Telemetry & Win Rate Curve**: Displays `Total Runs`, `Random Explore %`, `Last Score`, `Win Rate %`, and the dual-line **Win Rate (`%`) & Score Curve**.
- **2×2 Symmetrical Bento Grid**:
  - **`01` Circular Queue**: Live 10-segment SVG Ring Wheel (`MODULO 10`) + 10 slot cards `[0..9]` showing `FRONT (F)` and `REAR (R)`.
  - **`02` FIFO Queue**: Live `FRONT → ... → REAR` pipeline showing the shortest-path verification wave.
  - **`03` Linked Stack (LIFO)**: Live `TOP` pointer stack showing `.next` links and push/pop depth.
  - **`04` Singly Linked List**: Live `HEAD → [DIR (r,c)] → NULL` pointer chain and the 4 directional move rows (`UP, RIGHT, DOWN, LEFT`) for the selected tile.

---

## 7. Viva Voce — Frequently Asked Questions & Answers

**Q1: How do all 4 data structures interact during a single run?**
> **Answer**: First, the **FIFO Queue (`02`)** verifies that the Goal is reachable. Second, at each tile, the rover traverses the tile's **Singly Linked List (`04`)** to choose a valid move. Third, each step is pushed onto the **Linked Stack (`03`)** and enqueued into the **10-Slot Circular Queue (`01`)**. Finally, when the run ends, the **Linked Stack (`03`)** pops every step in reverse (`LIFO`) to update the scores, and 4 random slots are replayed from the **Circular Queue (`01`)**.

**Q2: What happens in the Circular Queue (`01`) when move #11 is made?**
> **Answer**: Because the Circular Queue has a fixed capacity of 10 slots (`[0]` through `[9]`), move #10 writes to index `9` and wraps `REAR` to `(9 + 1) % 10 = 0`. Move #11 overwrites index `0` (the oldest move) and advances `FRONT` to `(0 + 1) % 10 = 1`.

**Q3: Why does the rover move backward during Phase 2 (`STACK POP`)?**
> **Answer**: Because the reward (`+100` at Goal or `-50` at Trap) is discovered at the **end** of the path. By popping steps from the **LIFO Stack (`03`)**, we backtrack from the final tile to the start tile so each earlier tile receives its updated future score in one clean backward pass.
