export declare const IMAGE_EXTS: Set<string>;
export declare function isImageFile(name: string): boolean;
export declare function naturalCompare(a: string, b: string): number;
export declare function listFolderImages(dir: string): string[];
export interface EnvRoot {
    name: string;
    path: string;
}
export declare function envRoots(declared: string[], render: (template: string) => string): EnvRoot[];
