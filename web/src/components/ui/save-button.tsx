import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "react-i18next";
import { Button, type ButtonProps } from "./button";

interface SaveButtonProps extends Omit<ButtonProps, "children"> {
  isSaving: boolean;
  label?: string;
}

export function SaveButton({ isSaving, label, disabled, ...props }: SaveButtonProps) {
  const { t } = useTranslation();
  return (
    <Button size="sm" disabled={isSaving || disabled} {...props}>
      {isSaving ? (
        <>
          <Spinner size="sm" />
          {t("components.saveButton.states.saving")}
        </>
      ) : (
        (label ?? t("common.save"))
      )}
    </Button>
  );
}
