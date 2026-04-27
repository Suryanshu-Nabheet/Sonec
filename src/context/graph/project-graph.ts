/**
 * AutoCode Project Graph
 * 
 * Maintains a directed graph of project dependencies and symbol relationships.
 * Supports:
 * - File-level dependency mapping
 * - Symbol usage tracking
 * - Graph-based context discovery
 */

import * as vscode from 'vscode';
import { Logger } from '../../core/logger';

interface GraphNode {
    uri: string;
    type: 'file' | 'symbol';
    metadata: any;
}

interface GraphEdge {
    from: string;
    to: string;
    type: 'imports' | 'references' | 'extends' | 'implements';
}

/**
 * Represents the architectural graph of the project.
 */
export class ProjectGraph implements vscode.Disposable {
    private nodes: Map<string, GraphNode> = new Map();
    private edges: GraphEdge[] = [];
    private logger: Logger;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.logger = Logger.getInstance();
        this.initialize();
    }

    /**
     * Initializes the graph by scanning the workspace.
     */
    private async initialize(): Promise<void> {
        this.logger.info('Initializing Project Graph');
        // Initial scan logic here
    }

    /**
     * Adds a file node to the graph.
     * @param uri The URI of the file
     * @param metadata Optional metadata for the file
     */
    public addFileNode(uri: vscode.Uri, metadata: any = {}): void {
        const id = uri.toString();
        this.nodes.set(id, {
            uri: id,
            type: 'file',
            metadata
        });
    }

    /**
     * Adds a dependency edge between two nodes.
     * @param from The source file URI
     * @param to The target file URI
     * @param type The type of relationship
     */
    public addDependency(from: vscode.Uri, to: vscode.Uri, type: GraphEdge['type'] = 'imports'): void {
        this.edges.push({
            from: from.toString(),
            to: to.toString(),
            type
        });
    }

    /**
     * Gets all files that depend on the given file.
     * @param uri The URI of the file
     * @returns An array of URIs of dependent files
     */
    public getDependents(uri: vscode.Uri): vscode.Uri[] {
        const id = uri.toString();
        return this.edges
            .filter(e => e.to === id)
            .map(e => vscode.Uri.parse(e.from));
    }

    /**
     * Gets all files that the given file depends on.
     * @param uri The URI of the file
     * @returns An array of URIs of dependencies
     */
    public getDependencies(uri: vscode.Uri): vscode.Uri[] {
        const id = uri.toString();
        return this.edges
            .filter(e => e.from === id)
            .map(e => vscode.Uri.parse(e.to));
    }

    /**
     * Disposes the graph resources.
     */
    dispose() {
        this.nodes.clear();
        this.edges = [];
        this.disposables.forEach(d => d.dispose());
    }
}
