export interface NoteRef {
    ref: string;
    collection: string;
    id: string;
    start: number;
    end: number;
}
export declare function refsIn(text: string, collections: readonly string[]): NoteRef[];
