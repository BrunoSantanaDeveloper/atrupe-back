import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export class FinancialNotesUtil {
  /**
   * Adiciona uma nova nota ao campo notes, preservando o conteúdo anterior
   * @param currentNotes - Notas atuais
   * @param newNote - Nova nota a ser adicionada
   * @returns String com as notas atualizadas
   */
  static appendNote(currentNotes: string | null, newNote: string): string {
    if (!newNote || newNote.trim() === '') {
      return currentNotes || '';
    }

    const timestamp = format(new Date(), "dd/MM/yyyy 'às' HH:mm", {
      locale: ptBR,
    });
    const formattedNote = `[${timestamp}] ${newNote}`;

    if (!currentNotes || currentNotes.trim() === '') {
      return formattedNote;
    }

    return `${currentNotes}\n${formattedNote}`;
  }

  /**
   * Gera nota para alteração de valor total
   */
  static generateTotalAmountChangeNote(
    oldAmount: number,
    newAmount: number,
  ): string {
    const difference = newAmount - oldAmount;
    const diffText =
      difference > 0
        ? `acréscimo de R$ ${difference.toFixed(2)}`
        : `redução de R$ ${Math.abs(difference).toFixed(2)}`;

    return `Valor total alterado de R$ ${oldAmount.toFixed(2)} para R$ ${newAmount.toFixed(2)} (${diffText})`;
  }

  /**
   * Gera nota para alteração de data de referência
   */
  static generateReferenceDateChangeNote(oldDate: Date, newDate: Date): string {
    const oldFormatted = format(new Date(oldDate), 'dd/MM/yyyy', {
      locale: ptBR,
    });
    const newFormatted = format(new Date(newDate), 'dd/MM/yyyy', {
      locale: ptBR,
    });
    return `Data de referência alterada de ${oldFormatted} para ${newFormatted}`;
  }

  /**
   * Gera nota para alterações em parcelas (apenas adições e remoções)
   * Modificações individuais são registradas separadamente
   */
  static generateInstallmentChangesNote(
    addedCount: number,
    removedCount: number,
  ): string {
    const changes: string[] = [];

    if (addedCount > 0) {
      changes.push(`${addedCount} parcela(s) adicionada(s)`);
    }
    if (removedCount > 0) {
      changes.push(`${removedCount} parcela(s) removida(s)`);
    }

    if (changes.length === 0) return '';

    return `Parcelas alteradas: ${changes.join(', ')}`;
  }

  /**
   * Gera nota para alteração de valor de parcela individual
   */
  static generateInstallmentValueChangeNote(
    installmentNumber: number,
    oldAmount: number,
    newAmount: number,
  ): string {
    const difference = newAmount - oldAmount;
    const diffText =
      difference > 0
        ? `acréscimo de R$ ${difference.toFixed(2)}`
        : `redução de R$ ${Math.abs(difference).toFixed(2)}`;

    return `Parcela ${installmentNumber}: valor alterado de R$ ${oldAmount.toFixed(2)} para R$ ${newAmount.toFixed(2)} (${diffText})`;
  }

  /**
   * Gera nota para alteração de data de vencimento de parcela
   */
  static generateInstallmentDueDateChangeNote(
    installmentNumber: number,
    oldDate: Date,
    newDate: Date,
  ): string {
    const oldFormatted = format(new Date(oldDate), 'dd/MM/yyyy', {
      locale: ptBR,
    });
    const newFormatted = format(new Date(newDate), 'dd/MM/yyyy', {
      locale: ptBR,
    });
    return `Parcela ${installmentNumber}: vencimento alterado de ${oldFormatted} para ${newFormatted}`;
  }

  /**
   * Gera nota para múltiplas alterações
   */
  static generateMultipleChangesNote(changes: string[]): string {
    if (changes.length === 0) return '';
    if (changes.length === 1) return changes[0];

    return `Múltiplas alterações realizadas:\n  - ${changes.join('\n  - ')}`;
  }
}
