import { type EngineNote } from "./engine.js";
import { type NoteRef } from "./note-refs.js";
export interface NextNote extends EngineNote {
    refs: Array<NoteRef & {
        exists: boolean;
    }>;
}
export declare function notesFor(store: any, collection: string, ids: string[]): NextNote[];
export declare function byId(notes: NextNote[]): Map<string, NextNote[]>;
