"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hash_1 = require("./hash");
// CLASS DEFINITION
// ================================================================================================
class MerkleTree {
    // CONSTRUCTORS
    // --------------------------------------------------------------------------------------------
    static async createAsync(values, hashAlgorithm) {
        // FUTURE: implement asynchronous instantiation
        return MerkleTree.create(values, hashAlgorithm);
    }
    static create(values, hashAlgorithm) {
        // determine hash function
        const hash = hash_1.getHashFunction(hashAlgorithm);
        // allocate memory for tree nodes
        const depth = Math.ceil(Math.log2(values.length));
        const nodes = new Array(2 ** depth);
        // build first row of nodes (parents of values)
        const parentCount = nodes.length / 2;
        let i = parentCount, parent;
        for (let j = 0; j < values.length; j += 2, i++) {
            let value1 = values[j];
            let value2 = (j + 1 < values.length) ? values[j + 1] : value1;
            parent = hash(value1, value2);
            nodes[i] = parent;
        }
        // backfill any remaining parents
        while (i < nodes.length) {
            nodes[i] = parent;
            i++;
        }
        // calculate all other tree nodes
        for (let i = parentCount - 1; i > 0; i--) {
            nodes[i] = hash(nodes[i * 2], nodes[i * 2 + 1]);
        }
        return new MerkleTree(nodes, values, depth);
    }
    constructor(nodes, values, depth) {
        this.depth = depth;
        this.nodes = nodes;
        this.values = values;
    }
    // PUBLIC ACCESSORS
    // --------------------------------------------------------------------------------------------
    get root() {
        return this.nodes[1];
    }
    // PUBLIC METHODS
    // --------------------------------------------------------------------------------------------
    prove(index) {
        if (index < 0)
            throw new TypeError(`Invalid index: ${index}`);
        if (index > this.values.length)
            throw new TypeError(`Invalid index: ${index}`);
        if (!Number.isInteger(index))
            throw new TypeError(`Invalid index: ${index}`);
        const value1 = this.values[index];
        const value2 = this.values[index ^ 1];
        const proof = [value1, value2];
        index = (index + this.nodes.length) >> 1;
        while (index > 1) {
            proof.push(this.nodes[index ^ 1]);
            index = index >> 1;
        }
        return proof;
    }
    proveBatch(indexes) {
        const indexMap = mapIndexes(indexes, this.values.length);
        indexes = normalizeIndexes(indexes);
        const proof = {
            values: new Array(indexMap.size),
            nodes: new Array(indexes.length),
            depth: this.depth
        };
        // populate the proof with leaf node values
        let nextIndexes = [];
        for (let i = 0; i < indexes.length; i++) {
            let index = indexes[i];
            let v1 = this.values[index];
            let v2 = this.values[index + 1];
            // only values for indexes that were explicitly requested are included in values array
            const inputIndex1 = indexMap.get(index);
            const inputIndex2 = indexMap.get(index + 1);
            if (inputIndex1 !== undefined) {
                if (inputIndex2 !== undefined) {
                    proof.values[inputIndex1] = v1;
                    proof.values[inputIndex2] = v2;
                    proof.nodes[i] = [];
                }
                else {
                    proof.values[inputIndex1] = v1;
                    proof.nodes[i] = [v2];
                }
            }
            else {
                proof.values[inputIndex2] = v2;
                proof.nodes[i] = [v1];
            }
            nextIndexes.push((index + this.nodes.length) >> 1);
        }
        // add required internal nodes to the proof, skipping redundancies
        for (let d = this.depth - 1; d > 0; d--) {
            indexes = nextIndexes;
            nextIndexes = [];
            for (let i = 0; i < indexes.length; i++) {
                let siblingIndex = indexes[i] ^ 1;
                if (i + 1 < indexes.length && indexes[i + 1] === siblingIndex) {
                    i++;
                }
                else {
                    proof.nodes[i].push(this.nodes[siblingIndex]);
                }
                // add parent index to the set of next indexes
                nextIndexes.push(siblingIndex >> 1);
            }
        }
        return proof;
    }
    // STATIC METHODS
    // --------------------------------------------------------------------------------------------
    static verify(root, index, proof, hashAlgorithm) {
        const hash = hash_1.getHashFunction(hashAlgorithm);
        const r = index & 1;
        const value1 = proof[r];
        const value2 = proof[1 - r];
        let v = hash(value1, value2);
        index = (index + 2 ** (proof.length - 1)) >> 1;
        for (let i = 2; i < proof.length; i++) {
            if (index & 1) {
                v = hash(proof[i], v);
            }
            else {
                v = hash(v, proof[i]);
            }
            index = index >> 1;
        }
        return root.equals(v);
    }
    static verifyBatch(root, indexes, proof, hashAlgorithm) {
        const v = new Map();
        const hash = hash_1.getHashFunction(hashAlgorithm);
        // replace odd indexes, offset, and sort in ascending order
        const offset = 2 ** proof.depth;
        const indexMap = mapIndexes(indexes, offset);
        indexes = normalizeIndexes(indexes);
        if (indexes.length !== proof.nodes.length)
            return false;
        // for each index use values to compute parent nodes
        let nextIndexes = [];
        const proofPointers = new Array(indexes.length);
        for (let i = 0; i < indexes.length; i++) {
            let index = indexes[i];
            let v1, v2;
            const inputIndex1 = indexMap.get(index);
            const inputIndex2 = indexMap.get(index + 1);
            if (inputIndex1 !== undefined) {
                if (inputIndex2 !== undefined) {
                    v1 = proof.values[inputIndex1];
                    v2 = proof.values[inputIndex2];
                    proofPointers[i] = 0;
                }
                else {
                    v1 = proof.values[inputIndex1];
                    v2 = proof.nodes[i][0];
                    proofPointers[i] = 1;
                }
            }
            else {
                v1 = proof.nodes[i][0];
                v2 = proof.values[inputIndex2];
                proofPointers[i] = 1;
            }
            let parent = hash(v1, v2);
            let parentIndex = (offset + index >> 1);
            v.set(parentIndex, parent);
            nextIndexes.push(parentIndex);
        }
        // iteratively move up, until we get to the root
        for (let d = proof.depth - 1; d > 0; d--) {
            indexes = nextIndexes;
            nextIndexes = [];
            for (let i = 0; i < indexes.length; i++) {
                let nodeIndex = indexes[i];
                let siblingIndex = nodeIndex ^ 1;
                // determine the sibling
                let sibling;
                if (i + 1 < indexes.length && indexes[i + 1] === siblingIndex) {
                    sibling = v.get(siblingIndex);
                    i++;
                }
                else {
                    let pointer = proofPointers[i];
                    sibling = proof.nodes[i][pointer];
                    proofPointers[i] = pointer + 1;
                }
                let node = v.get(nodeIndex);
                // if either node wasn't found, proof fails
                if (node === undefined || sibling === undefined)
                    return false;
                // calculate parent node and add it to the next set of nodes
                let parent = (nodeIndex & 1) ? hash(sibling, node) : hash(node, sibling);
                let parentIndex = nodeIndex >> 1;
                v.set(parentIndex, parent);
                nextIndexes.push(parentIndex);
            }
        }
        return root.equals(v.get(1));
    }
}
exports.MerkleTree = MerkleTree;
// HELPER FUNCTIONS
// ================================================================================================
function normalizeIndexes(input) {
    input = input.slice().sort(compareNumbers);
    const output = new Set();
    for (let index of input) {
        output.add(index - (index & 1));
    }
    return Array.from(output);
}
function mapIndexes(input, maxValid) {
    const output = new Map();
    for (let i = 0; i < input.length; i++) {
        let index = input[i];
        output.set(index, i);
        if (index < 0)
            throw new TypeError(`Invalid index: ${index}`);
        if (index > maxValid)
            throw new TypeError(`Invalid index: ${index}`);
        if (!Number.isInteger(index))
            throw new TypeError(`Invalid index: ${index}`);
    }
    if (input.length !== output.size)
        throw new Error('Repeating indexes detected');
    return output;
}
function compareNumbers(a, b) {
    return a - b;
}
//# sourceMappingURL=MerkleTree.js.map