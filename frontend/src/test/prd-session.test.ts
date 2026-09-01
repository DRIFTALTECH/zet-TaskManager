import { describe, expect, it } from 'vitest';
import { mergePrdFiles, PRD_FILE_CAP } from '@/lib/prdSession';

describe('mergePrdFiles', () => {
  it('appends unique PRD files and skips duplicates and other types', () => {
    const a = new File(['a'], 'a.pdf');
    const b = new File(['b'], 'b.txt');
    const skip = new File(['x'], 'x.png');
    const next = mergePrdFiles([a], [a, b, skip]);
    expect(next.map(f => f.name)).toEqual(['a.pdf', 'b.txt']);
  });

  it(`caps at ${PRD_FILE_CAP} files`, () => {
    const many = Array.from({ length: PRD_FILE_CAP + 3 }, (_, i) => new File([`${i}`], `${i}.pdf`));
    expect(mergePrdFiles([], many)).toHaveLength(PRD_FILE_CAP);
  });
});
