export const navKey = (e: any) =>
  e.kind === "collection" ? e.descriptor.name : e.folder.key.replace(/^(?:ns|mod|grp):/, "")
