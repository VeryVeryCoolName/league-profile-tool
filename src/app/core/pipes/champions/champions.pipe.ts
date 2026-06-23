import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'champions',
    standalone: false
})
export class ChampionsPipe implements PipeTransform {
  transform(items: any[], filter: string): any {
    if (!items || !filter) {
      return items;
    }
    const search = filter.toLowerCase();
    return items.filter(item => {
      return String(item.name || '').toLowerCase().indexOf(search) !== -1 ||
        String(item.alt || '').toLowerCase().indexOf(search) !== -1;
    });
  }

}
