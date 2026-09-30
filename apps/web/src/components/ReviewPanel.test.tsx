import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewPanel } from './ReviewPanel';
import type { FindingDetail } from '../types';

const finding = (over: Partial<FindingDetail> = {}): FindingDetail => ({
  id: 7, inspectionId: 'insp-1', assetId: 'PG-102', assetName: 'Feed pump P-102 discharge pressure',
  status: 'needs_review', value: 4.2, unit: 'bar', confidence: 0.91, severity: 'high',
  reasons: ['robot_decimal_shift', 'outside_normal_band', 'confirm_alarm'],
  capturedAt: '2026-09-06T07:00:00Z', robotValue: 42, robotUnit: 'bar', robotConfidence: 0.8, audioRmsDb: 74,
  normalMin: 6, normalMax: 10, reading: { model: 'm', samples: [{ value: 4.2, readable: true, notes: 'needle below 5' }], input_tokens: 1, output_tokens: 1 },
  ...over,
});

describe('ReviewPanel', () => {
  it('shows robot and AI readings side by side', () => {
    render(<ReviewPanel finding={finding()} imageUrl="/img" onSubmit={() => {}} />);
    const row = screen.getByRole('row', { name: /reading/i });
    expect(row).toHaveTextContent('42 bar');
    expect(row).toHaveTextContent('4.2 bar');
    expect(screen.getByText('high severity')).toBeInTheDocument();
  });

  it('explains every reason in plain English', () => {
    render(<ReviewPanel finding={finding()} imageUrl="/img" onSubmit={() => {}} />);
    expect(screen.getByText(/decimal point error/i)).toBeInTheDocument();
    expect(screen.getByText(/please confirm/i)).toBeInTheDocument();
  });

  it('confirms the AI reading', async () => {
    const onSubmit = vi.fn();
    render(<ReviewPanel finding={finding()} imageUrl="/img" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /confirm ai reading/i }));
    expect(onSubmit).toHaveBeenCalledWith({ decision: 'confirm', note: undefined });
  });

  it('only allows saving a correction once a valid number is entered', async () => {
    const onSubmit = vi.fn();
    render(<ReviewPanel finding={finding()} imageUrl="/img" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /correct value/i }));
    const save = screen.getByRole('button', { name: /save correction/i });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/correct value \(bar\)/i), 'abc');
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/correct value \(bar\)/i));
    await userEvent.type(screen.getByLabelText(/correct value \(bar\)/i), '4.5');
    await userEvent.type(screen.getByLabelText(/note/i), 'glare');
    await userEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({ decision: 'correct', value: 4.5, note: 'glare' });
  });

  it('cannot confirm when the AI produced no value', () => {
    render(<ReviewPanel finding={finding({ value: null, reasons: ['image_unreadable'] })} imageUrl="/img" onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: /confirm ai reading/i })).toBeDisabled();
  });

  it('shows the outcome instead of the form once reviewed', () => {
    render(<ReviewPanel finding={finding({ status: 'reviewed', reviewDecision: 'correct', reviewedValue: 4.5 })} imageUrl="/img" onSubmit={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reviewed: correct (4.5 bar)');
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();
  });
});
