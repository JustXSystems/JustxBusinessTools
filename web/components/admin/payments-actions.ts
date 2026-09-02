export type PaymentsActionHandle = {
  save: () => Promise<void>;
  isBusy: () => boolean;
  isDirty?: () => boolean;
};
