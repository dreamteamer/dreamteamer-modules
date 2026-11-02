/** What an `<img>` can draw — the same gate the file-record views use. */
export declare const IMAGE_EXTS: Set<string>;
export declare function isImageFile(name: string): boolean;
/** `f-2` before `f-10`: digit runs compare as numbers, the rest as text. */
export declare function naturalCompare(a: string, b: string): number;
/** The image files in a folder, naturally sorted. A missing or unreadable folder is `[]`, never a throw
 *  — the route says WHY separately, by looking at the folder itself. */
export declare function listFolderImages(dir: string): string[];
export interface EnvRoot {
    /** The declared variable, e.g. FILES_FOLDER. */
    name: string;
    /** Its rendered value on this machine — an absolute directory that exists. */
    path: string;
}
/** Every declared variable that renders to an existing directory. `render` is the engine's
 *  `renderTemplate` bound to this workspace; a variable it cannot render (unset) is skipped, because
 *  an unset variable is not a place the webview can read from. */
export declare function envRoots(declared: string[], render: (template: string) => string): EnvRoot[];
