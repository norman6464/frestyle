package dev.frestyle.backend;

import static com.tngtech.archunit.base.DescribedPredicate.alwaysTrue;
import static com.tngtech.archunit.base.DescribedPredicate.not;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAPackage;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

// handler → usecase → repository / infra → domain
@AnalyzeClasses(packages = "dev.frestyle.backend", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    @ArchTest
    static final ArchRule domainは標準ライブラリだけに依存する = classes()
            .that().resideInAPackage("..domain..")
            .should().onlyDependOnClassesThat().resideInAnyPackage("..domain..", "java..");

    @ArchTest
    static final ArchRule handlerはadapterとinfraを直接呼ばない = noClasses()
            .that().resideInAPackage("..handler..")
            .should().dependOnClassesThat().resideInAnyPackage("..adapter..", "..infra..");

    @ArchTest
    static final ArchRule dtoはdomainだけに依存する = classes()
            .that().resideInAPackage("..handler.dto..")
            .should().onlyDependOnClassesThat().resideInAnyPackage("..handler.dto..", "..domain..", "java..");

    @ArchTest
    static final ArchRule usecaseはhandlerとadapterを知らない = noClasses()
            .that().resideInAPackage("..usecase..")
            .should().dependOnClassesThat().resideInAnyPackage("..handler..", "..adapter..");

    @ArchTest
    static final ArchRule usecaseのサブパッケージは互いに依存しない = slices()
            .matching("..usecase.(*)..")
            .should().notDependOnEachOther()
            .ignoreDependency(alwaysTrue(), resideInAPackage("..usecase.repository.."));

    @ArchTest
    static final ArchRule adapterとinfraはhandlerを知らない = noClasses()
            .that().resideInAnyPackage("..adapter..", "..infra..")
            .should().dependOnClassesThat().resideInAPackage("..handler..");

    @ArchTest
    static final ArchRule adapterとinfraがusecaseから使えるのはrepositoryのinterfaceだけ = noClasses()
            .that().resideInAnyPackage("..adapter..", "..infra..")
            .should().dependOnClassesThat(
                    resideInAPackage("..usecase..").and(not(resideInAPackage("..usecase.repository.."))));
}
