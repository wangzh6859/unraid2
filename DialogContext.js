import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import ModernConfirmDialog from './components/ModernConfirmDialog';

/**
 * Global Dialog Context & Manager
 * Provides unified, theme-aware modern squircle dialogs across the entire application.
 * Automatically bridges React Native Alert.alert so no ugly native alerts ever appear.
 */

const DialogContext = createContext(null);

let globalDialogHandler = null;

export const setGlobalDialogHandler = (handler) => {
  globalDialogHandler = handler;
};

// Auto-patch Alert.alert to render using our unified modern dialog
const originalAlert = Alert.alert;
Alert.alert = (title, message, buttons, options) => {
  if (globalDialogHandler) {
    globalDialogHandler(title, message, buttons, options);
  } else {
    // Fallback to original if context not mounted yet
    if (typeof originalAlert === 'function') {
      originalAlert(title, message, buttons, options);
    }
  }
};

export function DialogProvider({ children }) {
  const [dialogState, setDialogState] = useState({
    visible: false,
    type: 'info',
    title: '',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: false,
    onConfirm: null,
    onCancel: null,
    icon: null,
  });

  const hideDialog = useCallback(() => {
    setDialogState(prev => ({ ...prev, visible: false }));
  }, []);

  const showDialog = useCallback((config) => {
    setDialogState({
      visible: true,
      type: config.type || 'info',
      title: config.title || '',
      message: config.message || '',
      confirmText: config.confirmText || (config.showCancel ? '确定' : '知道了'),
      cancelText: config.cancelText || '取消',
      showCancel: !!config.showCancel,
      onConfirm: () => {
        hideDialog();
        if (config.onConfirm) config.onConfirm();
      },
      onCancel: () => {
        hideDialog();
        if (config.onCancel) config.onCancel();
      },
      icon: config.icon || null,
    });
  }, [hideDialog]);

  const showConfirm = useCallback(({
    title,
    message,
    type = 'warning',
    confirmText = '确定',
    cancelText = '取消',
    onConfirm,
    onCancel,
    icon,
  }) => {
    showDialog({
      visible: true,
      type,
      title,
      message,
      confirmText,
      cancelText,
      showCancel: true,
      onConfirm,
      onCancel,
      icon,
    });
  }, [showDialog]);

  const showError = useCallback((title, message, onConfirm) => {
    showDialog({
      type: 'error',
      title: title || '操作失败',
      message: message || '',
      showCancel: false,
      confirmText: '知道了',
      onConfirm,
    });
  }, [showDialog]);

  const showSuccess = useCallback((title, message, onConfirm) => {
    showDialog({
      type: 'success',
      title: title || '操作成功',
      message: message || '',
      showCancel: false,
      confirmText: '知道了',
      onConfirm,
    });
  }, [showDialog]);

  const showWarning = useCallback((title, message, onConfirm) => {
    showDialog({
      type: 'warning',
      title: title || '提示',
      message: message || '',
      showCancel: false,
      confirmText: '知道了',
      onConfirm,
    });
  }, [showDialog]);

  const showInfo = useCallback((title, message, onConfirm) => {
    showDialog({
      type: 'info',
      title: title || '提示',
      message: message || '',
      showCancel: false,
      confirmText: '知道了',
      onConfirm,
    });
  }, [showDialog]);

  // Handle Alert.alert calls
  useEffect(() => {
    const handleAlertCall = (title, message, buttons) => {
      const titleStr = String(title || '');
      const messageStr = String(message || '');

      if (!buttons || buttons.length === 0) {
        // Single button alert
        let type = 'info';
        if (/失败|错误|异常|拒绝|err|fail|exception/i.test(titleStr + messageStr)) {
          type = 'error';
        } else if (/成功|success|ok/i.test(titleStr + messageStr)) {
          type = 'success';
        } else if (/警告|注意|warn/i.test(titleStr + messageStr)) {
          type = 'warning';
        }

        showDialog({
          type,
          title: titleStr,
          message: messageStr,
          showCancel: false,
          confirmText: '知道了',
        });
      } else if (buttons.length === 1) {
        const btn = buttons[0];
        let type = 'info';
        if (/失败|错误|异常|拒绝|err|fail|exception/i.test(titleStr + messageStr)) {
          type = 'error';
        } else if (/成功|success|ok/i.test(titleStr + messageStr)) {
          type = 'success';
        } else if (/警告|注意|warn/i.test(titleStr + messageStr)) {
          type = 'warning';
        }

        showDialog({
          type,
          title: titleStr,
          message: messageStr,
          showCancel: false,
          confirmText: btn.text || '知道了',
          onConfirm: btn.onPress,
        });
      } else {
        // Multiple buttons (Confirmation)
        const cancelBtn = buttons.find(b => b.style === 'cancel') || buttons[0];
        const confirmBtn = buttons.find(b => b !== cancelBtn) || buttons[1];

        let type = 'warning';
        if (/删除|清空|卸载|停用|危险|重置/i.test(titleStr + messageStr + (confirmBtn.text || ''))) {
          type = 'danger';
        } else if (/重启|reboot/i.test(titleStr + messageStr)) {
          type = 'reboot';
        } else if (/关机|power/i.test(titleStr + messageStr)) {
          type = 'power';
        }

        showDialog({
          type,
          title: titleStr,
          message: messageStr,
          showCancel: true,
          cancelText: cancelBtn.text || '取消',
          confirmText: confirmBtn.text || '确定',
          onCancel: cancelBtn.onPress,
          onConfirm: confirmBtn.onPress,
        });
      }
    };

    setGlobalDialogHandler(handleAlertCall);
    return () => {
      setGlobalDialogHandler(null);
    };
  }, [showDialog]);

  return (
    <DialogContext.Provider
      value={{
        showDialog,
        showConfirm,
        showError,
        showSuccess,
        showWarning,
        showInfo,
        hideDialog,
      }}
    >
      {children}
      <ModernConfirmDialog
        visible={dialogState.visible}
        type={dialogState.type}
        title={dialogState.title}
        message={dialogState.message}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        showCancel={dialogState.showCancel}
        onConfirm={dialogState.onConfirm}
        onCancel={dialogState.onCancel}
        icon={dialogState.icon}
      />
    </DialogContext.Provider>
  );
}

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
};
