import type { ComponentPropsWithoutRef, RefObject } from 'react';
import { useAccessibleDialog } from '../hooks/use-accessible-dialog';

interface AccessibleDialogSurfaceProps extends Omit<ComponentPropsWithoutRef<'div'>, 'role'> {
  accessibleName: string;
  onRequestClose: () => void;
  role?: 'dialog' | 'alertdialog';
}

/**
 * 保留各业务页现有视觉样式，只统一弹窗的语义和键盘行为。
 */
export function AccessibleDialogSurface({
  accessibleName,
  onRequestClose,
  role = 'dialog',
  className = '',
  ...props
}: AccessibleDialogSurfaceProps) {
  const { dialogRef } = useAccessibleDialog(onRequestClose);
  return <div
    ref={dialogRef as RefObject<HTMLDivElement>}
    role={role}
    aria-modal="true"
    aria-label={accessibleName}
    tabIndex={-1}
    className={`${className} outline-none`}
    {...props}
  />;
}
