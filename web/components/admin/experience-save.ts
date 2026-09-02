export type ExperienceSaveHandle = {
  save: () => Promise<void>;
  isSaving: () => boolean;
};
