declare module "adm-zip" {
  export default class AdmZip {
    constructor(buffer?: Buffer);
    getEntries(): Array<{ entryName: string }>;
    getEntry(entryName: string): { getData(): Buffer } | null;
  }
}
