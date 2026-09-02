export type ToolsSaveHandle = {
  save: () => Promise<void>;
  isBusy: () => boolean;
  isDirty?: () => boolean;
  label?: () => string;
};
