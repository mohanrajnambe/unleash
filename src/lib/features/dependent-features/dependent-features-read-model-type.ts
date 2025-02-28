import { IDependency, IFeatureDependency } from '../../types';
import { FeatureDependency } from './dependent-features';

export interface IDependentFeaturesReadModel {
    getChildren(parents: string[]): Promise<string[]>;
    // given a list of parents and children verifies if some children would be orphaned after deletion
    // we're interested in the list of parents, not orphans
    getOrphanParents(parentsAndChildren: string[]): Promise<string[]>;
    getParents(child: string): Promise<IDependency[]>;
    getDependencies(children: string[]): Promise<IFeatureDependency[]>;
    getParentOptions(child: string): Promise<string[]>;
    hasDependencies(feature: string): Promise<boolean>;
}
