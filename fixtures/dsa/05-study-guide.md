# DSA visual playground — synthetic course

The four JSON files are mock teaching datasets. Their nodes and edges are the actual inputs used by the app's trusted traversal engine.

Suggested questions:

- Show BFS on the undirected graph, starting at A. Show the queue and explain the current step.
- Now show DFS on that same graph. Why does the order change?
- Why does marking a node discovered prevent looping around the cycle?
- Show the binary tree. Compare breadth-first traversal with inorder and preorder.
- What makes a binary search tree different from a general binary tree?
- Search the BST for 7, then for 5. Show each comparison and branch.
- Move to the next step, go back one step, or restart the traversal.

When several graph neighbours are available, use the order in the dataset's nodes list. Binary-tree traversals follow left before right. A traversal from one start node includes only nodes reachable from that start. BFS uses a first-in-first-out queue; DFS explores depth before returning to the remaining branches. Inorder traversal of a valid BST returns its values in sorted order.

The step controls change the saved visual. A worked traversal is a demonstration, not evidence that the learner completed independent practice.
