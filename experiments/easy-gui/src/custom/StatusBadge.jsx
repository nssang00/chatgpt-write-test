import React from 'react';
import {Tag} from 'antd';

/** Ordinary React/AntD component, without any Easy GUI-specific imports. */
export function StatusBadge({label='상태',active=false,tone='green'}){
  return <Tag color={active?tone:'default'}>{label}: {active?'활성':'비활성'}</Tag>;
}
